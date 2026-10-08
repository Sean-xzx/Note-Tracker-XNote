import { randomUUID } from 'crypto'
import { shell, dialog } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { extname, basename, join } from 'path'
import { getDb } from './db'
import {
  noteFileName,
  writeNoteFile,
  readNoteFile,
  readNoteBytes,
  spliceBytes,
  deleteNoteFile
} from './noteFiles'
import {
  storeFile,
  storedFilePath,
  readStoredBytes,
  writeStoredFileText,
  deleteStoredFile,
  fileNameWithoutExt
} from './fileStore'

/**
 * A library item as seen by the rest of the app. Two kinds share this table:
 *  - 'markdown': a note whose body lives in <id>.md (created scheduled).
 *  - 'file':     an uploaded file whose bytes live in files/<stored_name>
 *                (unscheduled, state 'library', until added to review).
 */
export interface Note {
  id: string
  title: string
  file_path: string | null
  tags: string[]
  created_at: string
  updated_at: string
  state: 'new' | 'learning' | 'review' | 'library'
  due_date: string | null
  last_reviewed_at: string | null
  stability: number
  difficulty: number
  reps: number
  lapses: number
  interval_days: number
  kind: 'markdown' | 'file' | 'folder'
  stored_name: string | null
  original_name: string | null
  mime_type: string | null
  /** Folder membership; null = top level. Virtual link (maps to dirs later). */
  parent_id: string | null
  /** Sibling order (float, so items insert between neighbours). */
  sort_order: number
  /** Soft-delete timestamp; non-null = in the recycle bin. */
  deleted_at: string | null
  /** Optional exam date (YYYY-MM-DD) on a file or folder: reviews land before it. */
  exam_date?: string | null
  /** Folders only: the parameter group their contents use (null = inherited / default). */
  param_group_id?: string | null
}

/** The raw row shape stored in SQLite (tags is a JSON string). */
interface NoteRow extends Omit<Note, 'tags'> {
  tags: string
}

/** Fields callers may patch via updateNote. `updated_at` is managed for them. */
export type NoteUpdate = Partial<
  Pick<
    Note,
    | 'title'
    | 'file_path'
    | 'tags'
    | 'state'
    | 'due_date'
    | 'last_reviewed_at'
    | 'stability'
    | 'difficulty'
    | 'reps'
    | 'lapses'
    | 'interval_days'
    | 'parent_id'
    | 'sort_order'
  >
>

export const nowIso = (): string => new Date().toISOString()
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** Calendar date in the LOCAL time zone (YYYY-MM-DD) — never the UTC date. */
export const localDate = (d: Date = new Date()): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const todayDate = (): string => localDate()
/** A local calendar day as a [start, end) range of UTC ISO timestamps (timestamps are stored in UTC). */
export function localDayRange(date: string): [string, string] {
  const [y, m, d] = date.split('-').map(Number)
  return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()]
}

/**
 * Return the text of the first level-1 heading (`# Heading`) in a markdown body,
 * or null if there isn't one. `## ...` and text without a following space are
 * deliberately not matched (they aren't H1s in CommonMark).
 */
export function firstH1(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#[ \t]+(.+?)[ \t]*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

/** Convert a DB row into a Note (parse the tags JSON). */
function rowToNote(row: NoteRow): Note {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed)) tags = parsed.map(String)
  } catch {
    // Malformed tags fall back to an empty array rather than throwing.
  }
  return { ...row, tags }
}

/** Next sort_order value to place an item at the end of a folder's children. */
function nextSortOrder(parentId: string | null): number {
  const row = getDb()
    .prepare(
      `SELECT MAX(sort_order) AS m FROM notes WHERE parent_id IS ? AND deleted_at IS NULL`
    )
    .get(parentId) as { m: number | null }
  return (row.m ?? 0) + 1
}

/**
 * Return `base`, or `base 2`/`base 3`/… if a non-deleted sibling already uses
 * that title in the same folder (so renames/creates never clash or error).
 */
function uniqueTitle(parentId: string | null, base: string, excludeId?: string): string {
  const rows = getDb()
    .prepare(
      `SELECT title FROM notes WHERE parent_id IS ? AND deleted_at IS NULL
       ${excludeId ? 'AND id != ?' : ''}`
    )
    .all(...(excludeId ? [parentId, excludeId] : [parentId])) as { title: string }[]
  const taken = new Set(rows.map((r) => r.title))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

/**
 * Create a note. Besides the SQLite row we create the backing `<id>.md` file
 * (seeded with the title as an H1) and record its path in `file_path`. If the
 * DB insert fails we roll back the file so we never leak an orphan on disk.
 * New notes are due today and in the 'new' state.
 */
export function createNote(
  title: string,
  tags: string[] = [],
  parentId: string | null = null
): Note {
  const now = nowIso()
  const id = randomUUID()
  const finalTitle = uniqueTitle(parentId, title)
  const note: Note = {
    id,
    title: finalTitle,
    file_path: noteFileName(id), // relative filename; resolved via notesDir()
    tags,
    created_at: now,
    updated_at: now,
    state: 'new',
    due_date: todayDate(),
    last_reviewed_at: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    interval_days: 0,
    kind: 'markdown',
    stored_name: null,
    original_name: null,
    mime_type: null,
    parent_id: parentId,
    sort_order: nextSortOrder(parentId),
    deleted_at: null
  }

  // Write the markdown file first; if this throws, nothing is inserted.
  writeNoteFile(id, `# ${finalTitle}\n`)

  try {
    getDb()
      .prepare(
        `INSERT INTO notes (
          id, title, file_path, tags, created_at, updated_at,
          state, due_date, last_reviewed_at, stability, difficulty,
          reps, lapses, interval_days, parent_id, sort_order
        ) VALUES (
          @id, @title, @file_path, @tags, @created_at, @updated_at,
          @state, @due_date, @last_reviewed_at, @stability, @difficulty,
          @reps, @lapses, @interval_days, @parent_id, @sort_order
        )`
      )
      .run({ ...note, tags: JSON.stringify(note.tags) })
  } catch (err) {
    // Roll back the file so a failed insert doesn't leave an orphan .md.
    deleteNoteFile(id)
    throw err
  }

  return note
}

/** Create a folder item (no body, no file). Deduped within its parent. */
export function createFolder(name: string, parentId: string | null = null): Note {
  const now = nowIso()
  const id = randomUUID()
  const finalName = uniqueTitle(parentId, name.trim() || '新建文件夹')
  const note: Note = {
    id,
    title: finalName,
    file_path: null,
    tags: [],
    created_at: now,
    updated_at: now,
    state: 'library',
    due_date: null,
    last_reviewed_at: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    interval_days: 0,
    kind: 'folder',
    stored_name: null,
    original_name: null,
    mime_type: null,
    parent_id: parentId,
    sort_order: nextSortOrder(parentId),
    deleted_at: null
  }
  getDb()
    .prepare(
      `INSERT INTO notes (
        id, title, file_path, tags, created_at, updated_at, state, due_date,
        last_reviewed_at, stability, difficulty, reps, lapses, interval_days,
        kind, parent_id, sort_order
      ) VALUES (
        @id, @title, @file_path, @tags, @created_at, @updated_at, @state, @due_date,
        @last_reviewed_at, @stability, @difficulty, @reps, @lapses, @interval_days,
        @kind, @parent_id, @sort_order
      )`
    )
    .run({ ...note, tags: JSON.stringify(note.tags) })
  return note
}

/** Fetch a single note by id, or null if it doesn't exist. */
export function getNote(id: string): Note | null {
  const row = getDb()
    .prepare(`SELECT * FROM notes WHERE id = ?`)
    .get(id) as NoteRow | undefined
  return row ? rowToNote(row) : null
}

/** List all live notes (excludes folders and trashed items), newest first. */
export function listNotes(): Note[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notes
       WHERE deleted_at IS NULL AND kind != 'folder'
       ORDER BY created_at DESC`
    )
    .all() as NoteRow[]
  return rows.map(rowToNote)
}

/**
 * Notes due for review on or before `date` (defaults to today), i.e. the
 * "review queue". Ordered by due date, then creation time for a stable order.
 */
export function getDueNotes(date: string = todayDate()): Note[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notes
       WHERE due_date IS NOT NULL AND due_date <= ? AND deleted_at IS NULL
       ORDER BY due_date ASC, created_at ASC`
    )
    .all(date) as NoteRow[]
  return rows.map(rowToNote)
}

/**
 * Create a file-library item: copy the source file into files/, store its
 * metadata as a note row of kind 'file'. Unscheduled by default (state
 * 'library', due_date null) — call addToReview to put it in the queue.
 */
/**
 * Save pasted/dropped images in a dedicated attachment folder. References use
 * the stable item id, so organizing attachments never changes markdown URLs.
 */
export function createImageAsset(noteId: string, name: string, bytes: Uint8Array): Note {
  const note = getNote(noteId)
  if (!note || note.kind !== 'markdown' || note.deleted_at) throw new Error('笔记不存在')
  const safe = basename(name).replace(/[\/:*?"<>|]/g, '_') || 'image.png'
  const dir = mkdtempSync(join(tmpdir(), 'xnote-img-'))
  const tmp = join(dir, safe)
  try {
    writeFileSync(tmp, Buffer.from(bytes))
    return createFileItem(tmp, imageAssetsFolder().id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const IMAGE_ASSETS_FOLDER_KEY = 'image_assets_folder'
const IMAGE_ASSETS_ORGANIZED_KEY = 'image_assets_organized_v1'

/** Reuse the managed folder by id, even after the user renames or moves it. */
function imageAssetsFolder(): Note {
  const d = getDb()
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get(IMAGE_ASSETS_FOLDER_KEY) as { value: string } | undefined
  const existing = row ? getNote(row.value) : null
  if (existing?.kind === 'folder' && !existing.deleted_at) return existing
  const folder = createFolder('笔记附件')
  d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(IMAGE_ASSETS_FOLDER_KEY, folder.id)
  return folder
}

/** One-time organization of existing inline images; bytes, ids and annotations stay intact. */
export function organizeImageAssets(): number {
  const d = getDb()
  if (d.prepare('SELECT value FROM meta WHERE key = ?').get(IMAGE_ASSETS_ORGANIZED_KEY)) return 0
  const referenced = new Set<string>()
  for (const note of listTree()) {
    if (note.kind !== 'markdown') continue
    try {
      const content = readNoteFile(note.id) ?? ''
      for (const match of content.matchAll(/xnote-file:\/\/([0-9a-f-]{36})/gi)) referenced.add(match[1].toLowerCase())
    } catch {
      // An unreadable note should not prevent the rest of the library opening.
    }
  }
  const images = listTree().filter((n) => n.kind === 'file' && n.mime_type?.startsWith('image/') &&
    n.state === 'library' && n.due_date === null && referenced.has(n.id))
  return d.transaction(() => {
    if (images.length) {
      const folder = imageAssetsFolder()
      let order = nextSortOrder(folder.id)
      const move = d.prepare('UPDATE notes SET parent_id = ?, sort_order = ? WHERE id = ?')
      for (const image of images) {
        if (image.parent_id !== folder.id) move.run(folder.id, order++, image.id)
      }
    }
    d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(IMAGE_ASSETS_ORGANIZED_KEY, 'done')
    return images.length
  })()
}

export function createFileItem(filePath: string, parentId: string | null = null): Note {
  // Uploaded markdown joins the normal markdown-note path (editable, preview,
  // H1→title sync, scheduled on creation) rather than becoming a file item.
  const ext = extname(filePath).toLowerCase()
  if (ext === '.md' || ext === '.markdown') {
    // Keep the uploaded bytes exactly (BOM, line endings, even invalid UTF-8):
    // the editor treats the file text as the single source of truth.
    const raw = readFileSync(filePath)
    const text = raw.toString('utf8')
    const heading = firstH1(text)
    const note = createNote(heading ?? fileNameWithoutExt(basename(filePath)), [], parentId)
    writeNoteFile(note.id, raw)
    return updateNote(note.id, heading ? { file_path: noteFileName(note.id), title: heading } : { file_path: noteFileName(note.id) }) ?? note
  }

  const stored = storeFile(filePath)
  const now = nowIso()
  const id = randomUUID()
  const note: Note = {
    id,
    title: uniqueTitle(parentId, fileNameWithoutExt(stored.original_name)),
    file_path: null,
    tags: [],
    created_at: now,
    updated_at: now,
    state: 'library',
    due_date: null,
    last_reviewed_at: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    interval_days: 0,
    kind: 'file',
    stored_name: stored.stored_name,
    original_name: stored.original_name,
    mime_type: stored.mime_type,
    parent_id: parentId,
    sort_order: nextSortOrder(parentId),
    deleted_at: null
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO notes (
          id, title, file_path, tags, created_at, updated_at, state, due_date,
          last_reviewed_at, stability, difficulty, reps, lapses, interval_days,
          kind, stored_name, original_name, mime_type, parent_id, sort_order
        ) VALUES (
          @id, @title, @file_path, @tags, @created_at, @updated_at, @state, @due_date,
          @last_reviewed_at, @stability, @difficulty, @reps, @lapses, @interval_days,
          @kind, @stored_name, @original_name, @mime_type, @parent_id, @sort_order
        )`
      )
      .run({ ...note, tags: JSON.stringify(note.tags) })
  } catch (err) {
    deleteStoredFile(stored.stored_name) // roll back the copied file
    throw err
  }

  return note
}

/** Open the native picker (multi-select) and create a file item per choice. */
export async function uploadFileItems(parentId: string | null = null): Promise<Note[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  })
  if (canceled) return []
  return filePaths.map((fp) => createFileItem(fp, parentId))
}

/** Read a file item's bytes (for in-app viewers). Null if not a file item. */
export function getFileBytes(id: string): Uint8Array | null {
  const note = getNote(id)
  if (!note || note.kind !== 'file' || !note.stored_name) return null
  try {
    return readStoredBytes(note.stored_name)
  } catch {
    return null
  }
}

/**
 * Save edited text back to a text file item's actual file (atomic write),
 * bumping updated_at. Returns the refreshed note, or null if not a file item.
 */
export function saveFileText(id: string, content: string): Note | null {
  const note = getNote(id)
  if (!note || note.kind !== 'file' || !note.stored_name) return null
  writeStoredFileText(note.stored_name, content)
  getDb().prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run(nowIso(), id)
  return getNote(id)
}

/**
 * Replace a file item's content with a newly-picked file: store the new bytes,
 * update stored_name/original_name/mime_type/updated_at, and delete the old
 * file. Keeps the same row (id, title, tags, review schedule).
 */
export async function pickAndReplaceFile(id: string): Promise<Note | null> {
  const note = getNote(id)
  if (!note || note.kind !== 'file') return null
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return note

  const oldStored = note.stored_name
  const stored = storeFile(filePaths[0])
  getDb()
    .prepare(
      `UPDATE notes SET stored_name = @stored_name, original_name = @original_name,
         mime_type = @mime_type, updated_at = @updated_at WHERE id = @id`
    )
    .run({
      id,
      stored_name: stored.stored_name,
      original_name: stored.original_name,
      mime_type: stored.mime_type,
      updated_at: nowIso()
    })
  if (oldStored && oldStored !== stored.stored_name) deleteStoredFile(oldStored)
  return getNote(id)
}

/** Open a file item in the OS default app (fallback for unpreviewable types). */
export function openFileInSystem(id: string): boolean {
  const note = getNote(id)
  if (!note || note.kind !== 'file' || !note.stored_name) return false
  void shell.openPath(storedFilePath(note.stored_name))
  return true
}

/** Put a library item into the review queue: state 'new', due today. */
export function addToReview(id: string): Note | null {
  const note = getNote(id)
  if (!note) return null
  return updateNote(id, { state: 'new', due_date: todayDate() })
}

/** Columns updateNote is allowed to write (prevents arbitrary-key injection). */
const UPDATABLE_COLUMNS = new Set<keyof NoteUpdate>([
  'title',
  'file_path',
  'tags',
  'state',
  'due_date',
  'last_reviewed_at',
  'stability',
  'difficulty',
  'reps',
  'lapses',
  'interval_days',
  'parent_id',
  'sort_order'
])

/** Patch a note's fields. Returns the updated note, or null if id not found. */
export function updateNote(id: string, fields: NoteUpdate): Note | null {
  const entries = Object.entries(fields).filter(([key]) =>
    UPDATABLE_COLUMNS.has(key as keyof NoteUpdate)
  )

  if (entries.length === 0) return getNote(id)

  const assignments: string[] = []
  const params: Record<string, unknown> = { id, updated_at: nowIso() }
  for (const [key, value] of entries) {
    assignments.push(`${key} = @${key}`)
    params[key] = key === 'tags' ? JSON.stringify(value) : value
  }
  assignments.push(`updated_at = @updated_at`)

  const info = getDb()
    .prepare(`UPDATE notes SET ${assignments.join(', ')} WHERE id = @id`)
    .run(params)

  return info.changes > 0 ? getNote(id) : null
}

/** A note's markdown body plus a flag for when the backing file is missing. */
export interface NoteContent {
  id: string
  content: string
  /** True when the row exists but its `.md` file could not be found on disk. */
  missing: boolean
}

/**
 * Write a note's markdown body to its `.md` file (atomically) and bump
 * `updated_at`. Also (re)records `file_path` in case it was ever null. Returns
 * the refreshed note, or null if the id doesn't exist.
 */
export function saveNoteContent(id: string, content: string): Note | null {
  const existing = getNote(id)
  if (!existing) return null

  // Lossless: an unchanged body is never rewritten, so its bytes on disk stay
  // exactly as they were (whatever their encoding details).
  const raw = readNoteBytes(id)
  const old = raw ? raw.toString('utf8') : null
  if (old !== content) {
    // bytes that are not valid UTF-8 survive edits elsewhere in the file
    const odd = raw && old !== null && !Buffer.from(old, 'utf8').equals(raw)
    writeNoteFile(id, (odd && spliceBytes(raw, old, content)) || content)
  }

  // Keep title in sync with the body's first H1, if it has one. Bodies without
  // an H1 leave the existing title untouched. Everything else stays decoupled.
  const patch: NoteUpdate = { file_path: noteFileName(id) }
  const heading = firstH1(content)
  if (heading) patch.title = heading

  // updateNote bumps updated_at for us.
  return updateNote(id, patch)
}

/**
 * Read a note's markdown body from disk. Returns null if the note row doesn't
 * exist. If the row exists but the file is gone, returns empty content with
 * `missing: true` rather than throwing, so the UI can recover.
 */
export function getNoteContent(id: string): NoteContent | null {
  const note = getNote(id)
  if (!note) return null

  const content = readNoteFile(id)
  return { id, content: content ?? '', missing: content === null }
}

/**
 * Delete a note (its review_logs cascade) and its `.md` file. Returns true if a
 * row was removed. File removal is best-effort: a leftover file never fails the
 * delete, since the authoritative row is already gone.
 */
export function deleteNote(id: string): boolean {
  const note = getNote(id)
  const info = getDb().prepare(`DELETE FROM notes WHERE id = ?`).run(id)
  if (info.changes === 0) return false

  // Remove the backing file: the stored file for file items, the .md otherwise.
  try {
    if (note?.kind === 'file' && note.stored_name) {
      deleteStoredFile(note.stored_name)
    } else if (note?.kind === 'markdown') {
      deleteNoteFile(id)
    }
  } catch {
    // Row is gone; a stray file is harmless. Swallow so delete still succeeds.
  }
  return true
}

// ---------------------------------------------------------------------------
// Tree / folder / recycle-bin operations
// ---------------------------------------------------------------------------

/** Rename a folder or item. Deduped within its parent; returns updated note. */
export function renameItem(id: string, newTitle: string): Note | null {
  const note = getNote(id)
  if (!note) return null
  const base = newTitle.trim() || note.title
  const finalTitle = uniqueTitle(note.parent_id, base, id)
  return updateNote(id, { title: finalTitle })
}

/** True if `targetId` is `rootId` or lives somewhere under it. */
function isSelfOrDescendant(rootId: string, targetId: string | null): boolean {
  let cur: string | null = targetId
  const guard = new Set<string>()
  while (cur) {
    if (cur === rootId) return true
    if (guard.has(cur)) break // corrupt cycle guard
    guard.add(cur)
    const row = getDb().prepare(`SELECT parent_id FROM notes WHERE id = ?`).get(cur) as
      | { parent_id: string | null }
      | undefined
    cur = row?.parent_id ?? null
  }
  return false
}

/**
 * Move an item into a new folder and/or reorder it. Rejects moving a folder
 * into itself or a descendant (would create a cycle). Returns the updated note,
 * or null if the move is invalid.
 */
export function moveItem(
  id: string,
  newParentId: string | null,
  newSortOrder: number
): Note | null {
  const note = getNote(id)
  if (!note) return null
  if (newParentId) {
    const parent = getNote(newParentId)
    if (!parent || parent.kind !== 'folder' || parent.deleted_at) return null
    // Cycle check: the new parent must not be the item itself or its descendant.
    if (isSelfOrDescendant(id, newParentId)) return null
  }
  const patch: NoteUpdate = { parent_id: newParentId, sort_order: newSortOrder }
  if (newParentId !== note.parent_id) {
    // Moving to a different folder: dedupe the title against new siblings.
    patch.title = uniqueTitle(newParentId, note.title, id)
  }
  return updateNote(id, patch)
}

/** All non-deleted items (folders included), for building the tree. */
export function listTree(): Note[] {
  const rows = getDb()
    .prepare(`SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY sort_order ASC`)
    .all() as NoteRow[]
  return rows.map(rowToNote)
}

/** Collect an id plus all its descendants (optionally including deleted rows). */
function collectSubtree(rootId: string, includeDeleted: boolean): string[] {
  const ids: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop() as string
    ids.push(cur)
    const children = getDb()
      .prepare(
        `SELECT id FROM notes WHERE parent_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`
      )
      .all(cur) as { id: string }[]
    for (const c of children) stack.push(c.id)
  }
  return ids
}

/** Soft-delete an item and its whole subtree (folders take their contents). */
export function softDelete(id: string): boolean {
  if (!getNote(id)) return false
  const now = nowIso()
  const ids = collectSubtree(id, false)
  const stmt = getDb().prepare(
    `UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`
  )
  const tx = getDb().transaction(() => {
    for (const i of ids) stmt.run(now, i)
  })
  tx()
  return true
}

/**
 * Restore a trashed item (and its subtree). If its original parent is gone or
 * still trashed, the item is restored to the top level.
 */
export function restore(id: string): Note | null {
  const note = getNote(id)
  if (!note) return null

  if (note.parent_id) {
    const parent = getNote(note.parent_id)
    if (!parent || parent.deleted_at) {
      getDb().prepare(`UPDATE notes SET parent_id = NULL WHERE id = ?`).run(id)
    }
  }
  const ids = collectSubtree(id, true)
  const stmt = getDb().prepare(`UPDATE notes SET deleted_at = NULL WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const i of ids) stmt.run(i)
  })
  tx()
  return getNote(id)
}

/** Recycle-bin roots: trashed items whose parent isn't itself trashed. */
export function listTrash(): Note[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notes t
       WHERE t.deleted_at IS NOT NULL
         AND (t.parent_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM notes p
                             WHERE p.id = t.parent_id AND p.deleted_at IS NOT NULL))
       ORDER BY t.deleted_at DESC`
    )
    .all() as NoteRow[]
  return rows.map(rowToNote)
}

/** Delete the backing file for a single row (best-effort). */
function deleteBackingFile(row: { id: string; kind: string; stored_name: string | null }): void {
  try {
    if (row.kind === 'file' && row.stored_name) deleteStoredFile(row.stored_name)
    else if (row.kind === 'markdown') deleteNoteFile(row.id)
  } catch {
    // best-effort
  }
}

/** Permanently delete an item + subtree: DB rows and their real files. */
export function permanentlyDelete(id: string): boolean {
  if (!getNote(id)) return false
  const ids = collectSubtree(id, true)
  const getRow = getDb().prepare(
    `SELECT id, kind, stored_name FROM notes WHERE id = ?`
  )
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const i of ids) {
      const row = getRow.get(i) as
        | { id: string; kind: string; stored_name: string | null }
        | undefined
      if (row) {
        deleteBackingFile(row)
        del.run(i)
      }
    }
  })
  tx()
  return true
}

/** Permanently delete everything in the recycle bin. */
export function emptyTrash(): number {
  const rows = getDb()
    .prepare(`SELECT id, kind, stored_name FROM notes WHERE deleted_at IS NOT NULL`)
    .all() as { id: string; kind: string; stored_name: string | null }[]
  const del = getDb().prepare(`DELETE FROM notes WHERE id = ?`)
  const tx = getDb().transaction(() => {
    for (const row of rows) {
      deleteBackingFile(row)
      del.run(row.id)
    }
  })
  tx()
  return rows.length
}
