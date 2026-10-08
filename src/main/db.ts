import { app } from 'electron'
import { join, extname, basename, dirname } from 'path'
import { renameSync, existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { DEFAULT_PARAMS } from './fsrs'

// Bump this when the schema changes and add a matching migration block below.
const CURRENT_SCHEMA_VERSION = 11

let db: Database.Database | null = null

/**
 * Returns the singleton database handle, creating and migrating it on first
 * call. The file lives under the OS user-data dir (never the project folder).
 */
export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'xnote.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL') // better concurrency + durability
  db.pragma('foreign_keys = ON') // enforce FK constraints (off by default)

  migrate(db)
  return db
}

/** Closes the DB handle (used on quit or in tests). */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function setVersion(d: Database.Database, n: number): void {
  d.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(n))
}

/**
 * Forward-only migration runner. Each step upgrades from N-1 to N and records
 * the new version, so an interrupted upgrade resumes cleanly. Most steps run in
 * a transaction; v4 rebuilds the notes table and must toggle foreign_keys,
 * which cannot happen inside a transaction.
 */
function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const row = d
    .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined
  let version = row ? parseInt(row.value, 10) : 0

  if (version < 1) {
    d.transaction(() => {
      d.exec(`
        CREATE TABLE notes (
          id               TEXT PRIMARY KEY,
          title            TEXT NOT NULL DEFAULT '',
          file_path        TEXT,
          tags             TEXT NOT NULL DEFAULT '[]',
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          state            TEXT NOT NULL DEFAULT 'new',
          due_date         TEXT NOT NULL,
          last_reviewed_at TEXT,
          stability        REAL NOT NULL DEFAULT 0,
          difficulty       REAL NOT NULL DEFAULT 0,
          reps             INTEGER NOT NULL DEFAULT 0,
          lapses           INTEGER NOT NULL DEFAULT 0,
          interval_days    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_notes_due_date ON notes (due_date);
        CREATE INDEX idx_notes_state ON notes (state);

        CREATE TABLE review_logs (
          id              TEXT PRIMARY KEY,
          note_id         TEXT NOT NULL,
          reviewed_at     TEXT NOT NULL,
          rating          INTEGER NOT NULL,
          interval_before REAL,
          interval_after  REAL,
          state           TEXT,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_review_logs_note_id ON review_logs (note_id);
      `)
      setVersion(d, 1)
    })()
    version = 1
  }

  if (version < 2) {
    d.transaction(() => {
      // Store the relative filename (`<id>.md`) rather than an absolute path.
      d.exec(`UPDATE notes SET file_path = id || '.md' WHERE file_path IS NOT NULL;`)
      setVersion(d, 2)
    })()
    version = 2
  }

  if (version < 3) {
    d.transaction(() => {
      d.exec(`
        CREATE TABLE attachments (
          id            TEXT PRIMARY KEY,
          note_id       TEXT NOT NULL,
          original_name TEXT NOT NULL,
          stored_name   TEXT NOT NULL,
          mime_type     TEXT,
          size_bytes    INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_attachments_note_id ON attachments (note_id);
      `)
      setVersion(d, 3)
    })()
    version = 3
  }

  if (version < 4) {
    migrateToUnifiedLibrary(d)
    version = 4
  }

  if (version < 5) {
    d.transaction(() => {
      // Virtual hierarchy: parent_id (folder membership), sort_order (sibling
      // order, float so items insert between neighbours), deleted_at (soft
      // delete / recycle bin). kind now also allows 'folder'. parent_id is a
      // virtual link today but is shaped to map onto real directories later.
      d.exec(`
        ALTER TABLE notes ADD COLUMN parent_id  TEXT;
        ALTER TABLE notes ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
        ALTER TABLE notes ADD COLUMN deleted_at TEXT;
      `)
      // Existing rows stay at top level (parent_id NULL), ordered by insertion.
      d.exec(`UPDATE notes SET sort_order = rowid;`)
      d.exec(`
        CREATE INDEX idx_notes_parent_id ON notes (parent_id);
        CREATE INDEX idx_notes_deleted_at ON notes (deleted_at);
      `)
      setVersion(d, 5)
    })()
    version = 5
  }

  if (version < 6) {
    d.transaction(() => {
      // Annotations live in their OWN table — never written into the original
      // file — so read-only files (PDF/docx) can be annotated, markdown notes
      // aren't polluted, and AI/review can query highlights uniformly. anchor is
      // a JSON DocAnchor (text + prefix/suffix context + locator). review_state/
      // due_date/last_reviewed_at are reserved for Step 5 (review per highlight).
      d.exec(`
        CREATE TABLE annotations (
          id               TEXT PRIMARY KEY,
          note_id          TEXT NOT NULL,
          type             TEXT NOT NULL,
          color            TEXT NOT NULL,
          anchor           TEXT NOT NULL,
          quote            TEXT NOT NULL DEFAULT '',
          note_text        TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          review_state     TEXT,
          due_date         TEXT,
          last_reviewed_at TEXT,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_annotations_note_id ON annotations (note_id);
        CREATE INDEX idx_annotations_created_at ON annotations (created_at);
      `)
      setVersion(d, 6)
    })()
    version = 6
  }

  if (version < 7) {
    d.transaction(() => {
      // RAG index: each item's extracted text is chunked; embeddings are stored
      // locally as Float32 BLOBs (cosine similarity is computed in the main
      // process). index_meta tracks per-item content hash + time for incremental
      // reindexing. Both cascade when their note is deleted.
      d.exec(`
        CREATE TABLE chunks (
          id          TEXT PRIMARY KEY,
          note_id     TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          text        TEXT NOT NULL,
          char_start  INTEGER,
          char_end    INTEGER,
          embedding   BLOB,                -- Float32 little-endian
          dim         INTEGER,
          model       TEXT,
          created_at  TEXT NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_chunks_note_id ON chunks (note_id);

        CREATE TABLE index_meta (
          note_id      TEXT PRIMARY KEY,
          content_hash TEXT NOT NULL,
          indexed_at   TEXT NOT NULL,
          chunk_count  INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        );
      `)
      setVersion(d, 7)
    })()
    version = 7
  }

  if (version < 8) {
    d.transaction(() => {
      // Persistent AI chat: multiple conversations, each with an ordered list of
      // messages. "Memory" is implemented by replaying a conversation's messages
      // as context on each turn (LLMs are stateless). Messages cascade-delete
      // with their conversation.
      d.exec(`
        CREATE TABLE conversations (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_conversations_updated ON conversations (updated_at);

        CREATE TABLE messages (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role            TEXT NOT NULL,
          content         TEXT NOT NULL,
          sources_json    TEXT,
          created_at      TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_messages_conversation ON messages (conversation_id);
      `)
      setVersion(d, 8)
    })()
    version = 8
  }

  if (version < 9) {
    d.transaction(() => {
      // Review reflections: optional free-text "what did I understand this
      // time", written after a review and linked to the review_logs row it came
      // from. Cascades with its note (and with the log row).
      d.exec(`
        CREATE TABLE review_reflections (
          id            TEXT PRIMARY KEY,
          note_id       TEXT NOT NULL,
          review_log_id TEXT,
          content       TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
          FOREIGN KEY (review_log_id) REFERENCES review_logs (id) ON DELETE CASCADE
        );
        CREATE INDEX idx_reflections_note ON review_reflections (note_id, created_at);
      `)
      setVersion(d, 9)
    })()
    version = 9
  }

  if (version < 10) {
    d.transaction(() => {
      // AI panel v2: each conversation remembers its model ({provider, model}
      // JSON); each assistant message keeps the tool steps it took to answer.
      d.exec(`
        ALTER TABLE conversations ADD COLUMN model TEXT;
        ALTER TABLE messages ADD COLUMN steps_json TEXT;
      `)
      setVersion(d, 10)
    })()
    version = 10
  }

  if (version < CURRENT_SCHEMA_VERSION) {
    // FSRS scheduling. The database is backed up first (the review history is
    // then replayed into FSRS state by review.ts: meta fsrs_replay = pending).
    backupBeforeMigration(d, version)
    d.transaction(() => {
      d.exec(`
        ALTER TABLE notes ADD COLUMN exam_date TEXT;
        ALTER TABLE notes ADD COLUMN param_group_id TEXT;
        ALTER TABLE review_logs ADD COLUMN duration_ms INTEGER;
        CREATE TABLE param_groups (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          params     TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `)
      d.prepare(`INSERT INTO param_groups (id, name, params, is_default, created_at) VALUES ('default', '笔记', ?, 1, ?)`).run(
        JSON.stringify(DEFAULT_PARAMS),
        new Date().toISOString()
      )
      d.prepare(`INSERT INTO meta (key, value) VALUES ('fsrs_replay', 'pending') ON CONFLICT(key) DO UPDATE SET value = 'pending'`).run()
      setVersion(d, CURRENT_SCHEMA_VERSION)
    })()
    version = CURRENT_SCHEMA_VERSION
  }
}

/** Copy of the whole database next to it, taken before a data-changing migration. */
function backupBeforeMigration(d: Database.Database, fromVersion: number): void {
  if (fromVersion < 1) return // brand-new database: nothing to keep
  const t = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}` // local time
  const target = join(dirname(d.name), `xnote.db.bak-v${fromVersion}-${stamp}`)
  d.prepare('VACUUM INTO ?').run(target)
}

/**
 * v4: generalize `notes` into a "library item" table. Adds kind/stored_name/
 * original_name/mime_type, makes due_date nullable (file items are unscheduled
 * until added to review), and folds any existing attachments into top-level
 * file items (moving their bytes from attachments/ to files/), then drops the
 * attachments table.
 *
 * Rebuilding the table requires foreign_keys OFF, which cannot be toggled
 * inside a transaction — so we toggle it around the transaction.
 */
function migrateToUnifiedLibrary(d: Database.Database): void {
  d.pragma('foreign_keys = OFF')
  try {
    d.transaction(() => {
      d.exec(`
        CREATE TABLE notes_new (
          id               TEXT PRIMARY KEY,
          title            TEXT NOT NULL DEFAULT '',
          file_path        TEXT,
          tags             TEXT NOT NULL DEFAULT '[]',
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          state            TEXT NOT NULL DEFAULT 'new',
          due_date         TEXT,                     -- nullable now (library items)
          last_reviewed_at TEXT,
          stability        REAL NOT NULL DEFAULT 0,
          difficulty       REAL NOT NULL DEFAULT 0,
          reps             INTEGER NOT NULL DEFAULT 0,
          lapses           INTEGER NOT NULL DEFAULT 0,
          interval_days    REAL NOT NULL DEFAULT 0,
          kind             TEXT NOT NULL DEFAULT 'markdown', -- 'markdown' | 'file'
          stored_name      TEXT,   -- file items: <uuid><ext> in files/
          original_name    TEXT,   -- file items: uploaded name
          mime_type        TEXT
        );

        INSERT INTO notes_new (
          id, title, file_path, tags, created_at, updated_at, state, due_date,
          last_reviewed_at, stability, difficulty, reps, lapses, interval_days,
          kind, stored_name, original_name, mime_type
        )
        SELECT
          id, title, file_path, tags, created_at, updated_at, state, due_date,
          last_reviewed_at, stability, difficulty, reps, lapses, interval_days,
          'markdown', NULL, NULL, NULL
        FROM notes;

        DROP TABLE notes;
        ALTER TABLE notes_new RENAME TO notes;
        CREATE INDEX idx_notes_due_date ON notes (due_date);
        CREATE INDEX idx_notes_state ON notes (state);
        CREATE INDEX idx_notes_kind ON notes (kind);
      `)

      // Fold any existing attachments into top-level file items.
      const hasAttachments = d
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='attachments'`)
        .get()
      if (hasAttachments) {
        const rows = d.prepare(`SELECT * FROM attachments`).all() as {
          original_name: string
          stored_name: string
          mime_type: string | null
          created_at: string
        }[]
        const insert = d.prepare(
          `INSERT INTO notes (
             id, title, file_path, tags, created_at, updated_at, state, due_date,
             last_reviewed_at, stability, difficulty, reps, lapses, interval_days,
             kind, stored_name, original_name, mime_type
           ) VALUES (
             @id, @title, NULL, '[]', @created_at, @created_at, 'library', NULL,
             NULL, 0, 0, 0, 0, 0, 'file', @stored_name, @original_name, @mime_type
           )`
        )
        const oldDir = join(app.getPath('userData'), 'attachments')
        const newDir = join(app.getPath('userData'), 'files')
        mkdirSync(newDir, { recursive: true })
        for (const a of rows) {
          const base = basename(a.original_name)
          const ext = extname(base)
          insert.run({
            id: randomUUID(),
            title: ext ? base.slice(0, -ext.length) : base,
            created_at: a.created_at,
            stored_name: a.stored_name,
            original_name: a.original_name,
            mime_type: a.mime_type
          })
          const from = join(oldDir, a.stored_name)
          const to = join(newDir, a.stored_name)
          if (existsSync(from)) {
            try {
              renameSync(from, to)
            } catch {
              // best-effort move; leave the old file if the move fails
            }
          }
        }
        d.exec(`DROP TABLE attachments;`)
      }

      setVersion(d, 4)
    })()
  } finally {
    d.pragma('foreign_keys = ON')
  }
}
