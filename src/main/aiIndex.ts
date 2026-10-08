import { randomUUID, createHash } from 'crypto'
import { getDb } from './db'
import { nowIso } from './notes'
import { realEmbeddingProvider } from './aiConfig'
import { getProvider } from './aiProviders'

// ---- chunking -------------------------------------------------------------
const CHUNK_CHARS = 3200 // ~800 tokens
const OVERLAP = 400 // ~100 tokens of overlap between neighbours

interface Piece {
  text: string
  start: number
  end: number
}
function chunkText(text: string): Piece[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= CHUNK_CHARS) return [{ text: clean, start: 0, end: clean.length }]
  const pieces: Piece[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(clean.length, i + CHUNK_CHARS)
    if (end < clean.length) {
      const slice = clean.slice(i, end)
      const brk = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('. ')
      )
      if (brk > CHUNK_CHARS * 0.5) end = i + brk + 1
    }
    pieces.push({ text: clean.slice(i, end).trim(), start: i, end })
    if (end >= clean.length) break
    i = Math.max(0, end - OVERLAP)
  }
  return pieces.filter((p) => p.text.length > 0)
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

// ---- incremental planning -------------------------------------------------
export interface PlanItem {
  id: string
  updated_at: string
}
export function indexPlan(items: PlanItem[]): { toIndex: string[]; upToDate: number } {
  const get = getDb().prepare(`SELECT indexed_at FROM index_meta WHERE note_id = ?`)
  const toIndex: string[] = []
  let upToDate = 0
  for (const it of items) {
    const m = get.get(it.id) as { indexed_at: string } | undefined
    if (!m || m.indexed_at < it.updated_at) toIndex.push(it.id)
    else upToDate++
  }
  return { toIndex, upToDate }
}

export interface IndexResult {
  status: 'indexed' | 'skipped' | 'empty'
  chunks: number
}
/** Chunk + embed + store one item's text (skips if content hash is unchanged). */
export async function indexNote(noteId: string, text: string): Promise<IndexResult> {
  const hash = sha1(text)
  const meta = getDb()
    .prepare(`SELECT content_hash, chunk_count FROM index_meta WHERE note_id = ?`)
    .get(noteId) as { content_hash: string; chunk_count: number } | undefined
  if (meta && meta.content_hash === hash) return { status: 'skipped', chunks: meta.chunk_count }

  const pieces = chunkText(text)
  const now = nowIso()
  const db = getDb()

  if (pieces.length === 0) {
    db.transaction(() => {
      db.prepare(`DELETE FROM chunks WHERE note_id = ?`).run(noteId)
      upsertMeta(noteId, hash, now, 0)
    })()
    return { status: 'empty', chunks: 0 }
  }

  // Real vector embeddings when OpenAI/Google is configured; otherwise store the
  // chunk text with no vector (model = 'keyword') so keyword retrieval still
  // works with a DeepSeek-only setup. No fake/mock vectors are ever stored.
  const real = realEmbeddingProvider()
  let vectors: number[][] = []
  const model = real ? real.config.embedModel : 'keyword'
  if (real) {
    vectors = await getProvider(real.id, real.key).embed(
      pieces.map((p) => p.text),
      { model: real.config.embedModel }
    )
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM chunks WHERE note_id = ?`).run(noteId)
    const ins = db.prepare(
      `INSERT INTO chunks (id, note_id, chunk_index, text, char_start, char_end, embedding, dim, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    pieces.forEach((p, idx) => {
      const vec = vectors[idx] ?? []
      const buf = Buffer.from(new Float32Array(vec).buffer)
      ins.run(randomUUID(), noteId, idx, p.text, p.start, p.end, buf, vec.length, model, now)
    })
    upsertMeta(noteId, hash, now, pieces.length)
  })()
  return { status: 'indexed', chunks: pieces.length }
}

function upsertMeta(noteId: string, hash: string, at: string, count: number): void {
  getDb()
    .prepare(
      `INSERT INTO index_meta (note_id, content_hash, indexed_at, chunk_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash,
         indexed_at=excluded.indexed_at, chunk_count=excluded.chunk_count`
    )
    .run(noteId, hash, at, count)
}

export function clearIndex(noteId?: string): void {
  const db = getDb()
  if (noteId) {
    db.prepare(`DELETE FROM chunks WHERE note_id = ?`).run(noteId)
    db.prepare(`DELETE FROM index_meta WHERE note_id = ?`).run(noteId)
  } else {
    db.exec(`DELETE FROM chunks; DELETE FROM index_meta;`)
  }
}

export function indexStatus(): { indexedNotes: number; totalChunks: number } {
  const n = getDb().prepare(`SELECT COUNT(*) AS c FROM index_meta`).get() as { c: number }
  const t = getDb().prepare(`SELECT COUNT(*) AS c FROM chunks`).get() as { c: number }
  return { indexedNotes: n.c, totalChunks: t.c }
}

// ---- retrieval ------------------------------------------------------------
function cosine(a: Float32Array, b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

interface ScoredChunk {
  note_id: string
  title: string
  text: string
  chunk_index: number
  score: number
}

/** Query terms for keyword matching: latin words + CJK bigrams (and singles). */
export function queryTerms(q: string): string[] {
  const lower = q.toLowerCase()
  const latin = lower.match(/[a-z0-9]{2,}/g) ?? []
  const cjk = lower.match(/[一-鿿]/g) ?? []
  const grams: string[] = []
  for (let i = 0; i < cjk.length - 1; i++) grams.push(cjk[i] + cjk[i + 1])
  if (cjk.length <= 2) grams.push(...cjk) // very short queries: allow single chars
  return [...new Set([...latin, ...grams])].filter((t) => t.length > 0)
}

/** Keyword relevance in [0,1]: distinct-term coverage + a small frequency bonus. */
export function keywordScore(text: string, title: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const body = text.toLowerCase()
  const head = title.toLowerCase()
  let matched = 0
  let occ = 0
  for (const t of terms) {
    const inTitle = head.includes(t)
    const c = body.split(t).length - 1
    if (c > 0 || inTitle) matched++
    occ += c + (inTitle ? 2 : 0)
  }
  const coverage = matched / terms.length
  return Math.min(1, coverage + Math.min(occ, 20) / 200)
}

/** Rank chunks for a query — real vectors when configured, else keyword match. */
async function scoreChunks(query: string, scope: string): Promise<ScoredChunk[]> {
  const real = realEmbeddingProvider()
  if (real) {
    const [qv] = await getProvider(real.id, real.key).embed([query], { model: real.config.embedModel })
    const rows = getDb()
      .prepare(
        `SELECT c.note_id, c.text, c.chunk_index, c.embedding, n.title
         FROM chunks c JOIN notes n ON n.id = c.note_id
         WHERE n.deleted_at IS NULL AND c.model = @model
         ${scope !== 'all' ? 'AND c.note_id = @note' : ''}`
      )
      .all({ model: real.config.embedModel, note: scope }) as {
      note_id: string
      text: string
      chunk_index: number
      embedding: Buffer
      title: string
    }[]
    const scored = rows.map((r) => {
      const emb = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4)
      return { note_id: r.note_id, title: r.title, text: r.text, chunk_index: r.chunk_index, score: cosine(emb, qv) }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored
  }

  // Keyword fallback (DeepSeek-only / no vector provider): match over chunk text.
  const terms = queryTerms(query)
  const rows = getDb()
    .prepare(
      `SELECT c.note_id, c.text, c.chunk_index, n.title
       FROM chunks c JOIN notes n ON n.id = c.note_id
       WHERE n.deleted_at IS NULL
       ${scope !== 'all' ? 'AND c.note_id = @note' : ''}`
    )
    .all({ note: scope }) as { note_id: string; text: string; chunk_index: number; title: string }[]
  const scored = rows
    .map((r) => ({
      note_id: r.note_id,
      title: r.title,
      text: r.text,
      chunk_index: r.chunk_index,
      score: keywordScore(r.text, r.title, terms)
    }))
    .filter((s) => s.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored
}

function snippet(text: string, query: string): string {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1)
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0) {
      pos = i
      break
    }
  }
  if (pos < 0) return text.slice(0, 160).trim() + (text.length > 160 ? '…' : '')
  const start = Math.max(0, pos - 60)
  const end = Math.min(text.length, pos + 100)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
}

export interface SemanticHit {
  noteId: string
  title: string
  snippet: string
  score: number
}
/** Best-matching files for a query (one hit per file, most relevant first). */
export async function semanticSearch(query: string, scope: string): Promise<SemanticHit[]> {
  if (!query.trim()) return []
  const scored = await scoreChunks(query, scope)
  const byNote = new Map<string, ScoredChunk>()
  for (const s of scored) {
    const cur = byNote.get(s.note_id)
    if (!cur || cur.score < s.score) byNote.set(s.note_id, s)
  }
  return [...byNote.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((s) => ({ noteId: s.note_id, title: s.title, snippet: snippet(s.text, query), score: Math.round(s.score * 1000) / 1000 }))
}
