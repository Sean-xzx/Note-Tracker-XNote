import { randomUUID } from 'crypto'
import { getDb } from './db'
import { nowIso } from './notes'

export type AnnoType = 'highlight' | 'underline' | 'wavy' | 'comment' | 'rect' | 'drawing'

export interface TextLocator {
  type: 'text'
  start: number
  end: number
}
/** Character-level PDF span: char offsets within the page's text layer. */
export interface PdfLocator {
  type: 'pdf'
  page: number
  start: number
  end: number
}
/** Rectangle region, normalized 0..1 within a page (pdf) or the image (page 0). */
export interface RectLocator {
  type: 'rect'
  page: number
  x: number
  y: number
  w: number
  h: number
}
/** Freehand stroke: points normalized 0..1 within a page (pdf)/image(page 0)/
 *  substrate; size is a fraction of the surface width. */
export interface DrawingLocator {
  type: 'drawing'
  page: number
  points: number[][]
  size: number
  /** 'marker' = translucent wide highlighter; default/absent = pen */
  tool?: 'pen' | 'marker'
}
/** Markdown source span: UTF-16 offsets into the note's .md text. The anchor's
 *  text/prefix/suffix are source text too, used to re-locate after edits. */
export interface MdLocator {
  type: 'md'
  start: number
  end: number
}
export type AnnoLocator = TextLocator | PdfLocator | RectLocator | DrawingLocator | MdLocator

/** A stable anchor: exact text + surrounding context + position locator. */
export interface AnnoAnchor {
  text: string
  prefix: string
  suffix: string
  locator: AnnoLocator
}

export interface Annotation {
  id: string
  note_id: string
  type: AnnoType
  color: string
  anchor: AnnoAnchor
  quote: string
  note_text: string | null
  created_at: string
  updated_at: string
  // Reserved for Step 5 (review each highlight); unused this step.
  review_state: string | null
  due_date: string | null
  last_reviewed_at: string | null
}

/** Fields a new annotation is created with. */
export interface NewAnnotation {
  type: AnnoType
  color: string
  anchor: AnnoAnchor
  quote: string
  note_text?: string | null
}

interface AnnoRow extends Omit<Annotation, 'anchor'> {
  anchor: string
}

function rowToAnnotation(row: AnnoRow): Annotation {
  let anchor: AnnoAnchor
  try {
    anchor = JSON.parse(row.anchor)
  } catch {
    anchor = { text: row.quote, prefix: '', suffix: '', locator: { type: 'text', start: 0, end: 0 } }
  }
  return { ...row, anchor }
}

export function addAnnotation(noteId: string, data: NewAnnotation): Annotation {
  const now = nowIso()
  const anno: Annotation = {
    id: randomUUID(),
    note_id: noteId,
    type: data.type,
    color: data.color,
    anchor: data.anchor,
    quote: data.quote,
    note_text: data.note_text ?? null,
    created_at: now,
    updated_at: now,
    review_state: null,
    due_date: null,
    last_reviewed_at: null
  }
  getDb()
    .prepare(
      `INSERT INTO annotations (
         id, note_id, type, color, anchor, quote, note_text, created_at, updated_at
       ) VALUES (@id, @note_id, @type, @color, @anchor, @quote, @note_text, @created_at, @updated_at)`
    )
    .run({ ...anno, anchor: JSON.stringify(anno.anchor) })
  return anno
}

/** Annotations for one note, oldest first (stable rendering order). */
export function listAnnotations(noteId: string): Annotation[] {
  const rows = getDb()
    .prepare(`SELECT * FROM annotations WHERE note_id = ? ORDER BY created_at ASC`)
    .all(noteId) as AnnoRow[]
  return rows.map(rowToAnnotation)
}

const UPDATABLE = new Set(['color', 'note_text', 'type'])

export function updateAnnotation(
  id: string,
  fields: { color?: string; note_text?: string | null; type?: AnnoType }
): Annotation | null {
  const entries = Object.entries(fields).filter(([k]) => UPDATABLE.has(k))
  if (entries.length === 0) {
    const row = getDb().prepare(`SELECT * FROM annotations WHERE id = ?`).get(id) as AnnoRow | undefined
    return row ? rowToAnnotation(row) : null
  }
  const assignments = entries.map(([k]) => `${k} = @${k}`)
  assignments.push(`updated_at = @updated_at`)
  const params: Record<string, unknown> = { id, updated_at: nowIso() }
  for (const [k, v] of entries) params[k] = v
  const info = getDb()
    .prepare(`UPDATE annotations SET ${assignments.join(', ')} WHERE id = @id`)
    .run(params)
  if (info.changes === 0) return null
  const row = getDb().prepare(`SELECT * FROM annotations WHERE id = ?`).get(id) as AnnoRow
  return rowToAnnotation(row)
}

export function deleteAnnotation(id: string): boolean {
  return getDb().prepare(`DELETE FROM annotations WHERE id = ?`).run(id).changes > 0
}

/** Re-insert an annotation exactly as it was (same id/timestamps) — used by undo/redo. */
export function restoreAnnotation(a: Annotation): Annotation {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO annotations (
         id, note_id, type, color, anchor, quote, note_text, created_at, updated_at,
         review_state, due_date, last_reviewed_at
       ) VALUES (@id, @note_id, @type, @color, @anchor, @quote, @note_text, @created_at, @updated_at,
         @review_state, @due_date, @last_reviewed_at)`
    )
    .run({ ...a, anchor: JSON.stringify(a.anchor) })
  return a
}

/** An annotation joined with its note's title (for the cross-file timeline). */
export interface AnnotationWithNote extends Annotation {
  note_title: string
  note_kind: string
}

function rowToWithNote(row: AnnoRow & { note_title: string; note_kind: string }): AnnotationWithNote {
  return { ...rowToAnnotation(row), note_title: row.note_title, note_kind: row.note_kind }
}

/** All annotations across the library (excludes trashed notes), newest first. */
export function listAllAnnotations(): AnnotationWithNote[] {
  const rows = getDb()
    .prepare(
      `SELECT a.*, n.title AS note_title, n.kind AS note_kind
       FROM annotations a JOIN notes n ON n.id = a.note_id
       WHERE n.deleted_at IS NULL
       ORDER BY a.created_at DESC`
    )
    .all() as (AnnoRow & { note_title: string; note_kind: string })[]
  return rows.map(rowToWithNote)
}

/** Annotations created within [from, to] (ISO), newest first — for the timeline. */
export function listAnnotationsByDate(from?: string, to?: string): AnnotationWithNote[] {
  const clauses = ['n.deleted_at IS NULL']
  const params: Record<string, string> = {}
  if (from) {
    clauses.push('a.created_at >= @from')
    params.from = from
  }
  if (to) {
    clauses.push('a.created_at <= @to')
    params.to = to
  }
  const rows = getDb()
    .prepare(
      `SELECT a.*, n.title AS note_title, n.kind AS note_kind
       FROM annotations a JOIN notes n ON n.id = a.note_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY a.created_at DESC`
    )
    .all(params) as (AnnoRow & { note_title: string; note_kind: string })[]
  return rows.map(rowToWithNote)
}

/**
 * Persist re-located anchors (markdown text annotations follow the source as it
 * is edited). Not a user edit of the annotation itself, so updated_at is kept.
 */
export function updateAnchors(items: { id: string; anchor: AnnoAnchor; quote: string }[]): number {
  const stmt = getDb().prepare(`UPDATE annotations SET anchor = @anchor, quote = @quote WHERE id = @id`)
  const run = getDb().transaction((xs: typeof items) => {
    let n = 0
    for (const x of xs) n += stmt.run({ id: x.id, anchor: JSON.stringify(x.anchor), quote: x.quote }).changes
    return n
  })
  return run(items)
}
