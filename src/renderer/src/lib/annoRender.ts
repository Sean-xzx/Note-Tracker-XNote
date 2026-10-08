import type { Annotation } from '../../../preload'
import { resolveColor } from './annoColors'
import { sweepTiming } from './annoMotion'

export type PenTool = 'pen' | 'marker' | 'eraser'
export type EraserMode = 'stroke' | 'partial'

/** A stroke to create: points normalized 0..1 to the surface; size = fraction of width. */
export interface NewStroke {
  page: number
  points: number[][]
  size: number
  color: string
  tool: 'pen' | 'marker'
}

/** Everything a freehand surface needs from the document. */
export interface PenProps {
  active: boolean // pen mode on
  tool: PenTool
  sizePx: number // current tool size in screen px
  color: string
  eraserMode: EraserMode
  onCreate: (s: NewStroke) => Promise<void>
  /** Eraser result: strokes to delete + stroke pieces to create (partial erase). */
  onEraseCommit: (removed: Annotation[], added: NewStroke[]) => Promise<void>
}

/** Props every renderer receives so it can paint + create annotations. */
export interface AnnoRenderProps {
  annos: Annotation[]
  activeAnnoId: string | null
  rectMode: boolean
  pen: PenProps
  onAnnoClick: (id: string) => void
  onOrphans: (ids: string[]) => void
  onCreateRect: (page: number, x: number, y: number, w: number, h: number) => void
}

// ---- text location (robust to edits: quote first, context disambiguates) ---
function commonTail(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
function commonHead(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** Best start index of `quote` in `full`, disambiguated by context. -1 if none. */
export function locateInText(full: string, quote: string, prefix: string, suffix: string): number {
  if (!quote) return -1
  const idxs: number[] = []
  let i = full.indexOf(quote)
  while (i !== -1) {
    idxs.push(i)
    i = full.indexOf(quote, i + 1)
  }
  if (idxs.length === 0) return -1
  if (idxs.length === 1) return idxs[0]
  let best = idxs[0]
  let bestScore = -1
  for (const idx of idxs) {
    const pre = full.slice(Math.max(0, idx - prefix.length), idx)
    const suf = full.slice(idx + quote.length, idx + quote.length + suffix.length)
    const score = commonTail(pre, prefix) + commonHead(suf, suffix)
    if (score > bestScore) {
      bestScore = score
      best = idx
    }
  }
  return best
}

/** A character-level Range spanning [start, start+len) within root's text. */
export function buildCharRange(root: HTMLElement, start: number, len: number): Range | null {
  const end = start + len
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    const l = t.nodeValue?.length ?? 0
    const ns = pos
    const ne = pos + l
    if (startNode === null && start >= ns && start < ne) {
      startNode = t
      startOff = start - ns
    }
    if (end > ns && end <= ne) {
      endNode = t
      endOff = end - ns
      break
    }
    pos = ne
  }
  if (!startNode || !endNode) return null
  try {
    const r = document.createRange()
    r.setStart(startNode, startOff)
    r.setEnd(endNode, endOff)
    return r
  } catch {
    return null
  }
}

export interface LocalRect {
  x: number
  y: number
  w: number
  h: number
}

/** getClientRects for a range, expressed in coordinates local to `originEl`. */
function localRects(range: Range, origin: DOMRect): LocalRect[] {
  const out: LocalRect[] = []
  for (const c of range.getClientRects()) {
    if (c.width <= 0.5 || c.height <= 0.5) continue
    const x = c.left - origin.left
    const y = c.top - origin.top
    // an inline element (e.g. <strong>) and its text report the same box: paint it once
    if (out.some((o) => Math.abs(o.x - x) < 0.5 && Math.abs(o.y - y) < 0.5 && Math.abs(o.w - c.width) < 0.5 && Math.abs(o.h - c.height) < 0.5)) continue
    out.push({ x, y, w: c.width, h: c.height })
  }
  return out
}

export interface PaintResult {
  orphaned: string[]
  rectsById: Map<string, LocalRect[]>
}

/**
 * Paint character-level text annotations (highlight / underline / wavy /
 * comment) as absolutely-positioned overlay boxes inside `overlayEl` (which
 * covers `substrateEl` and shares its coordinate origin). No original DOM is
 * mutated, so text alignment (esp. the pdf.js text layer) is never disturbed.
 * Returns orphaned ids + the painted rects (for click hit-testing).
 */
export function paintCharAnnos(
  overlayEl: HTMLElement,
  substrateEl: HTMLElement,
  annos: Annotation[],
  activeId: string | null
): PaintResult {
  overlayEl.replaceChildren()
  const origin = overlayEl.getBoundingClientRect()
  const full = substrateEl.textContent ?? ''
  const orphaned: string[] = []
  const rectsById = new Map<string, LocalRect[]>()

  for (const a of annos) {
    const loc = a.anchor.locator
    if (loc.type !== 'text' && loc.type !== 'pdf') continue
    if (a.type === 'rect' || a.type === 'drawing') continue
    if (!a.quote) {
      orphaned.push(a.id)
      continue
    }
    const start = locateInText(full, a.quote, a.anchor.prefix, a.anchor.suffix)
    if (start < 0) {
      orphaned.push(a.id)
      continue
    }
    const range = buildCharRange(substrateEl, start, a.quote.length)
    const rects = range ? localRects(range, origin) : []
    if (rects.length === 0) {
      orphaned.push(a.id)
      continue
    }
    rectsById.set(a.id, rects)
    const c = resolveColor(a.color)
    // newly created by the user → sweep in line by line; otherwise appear as-is
    const sweep = sweepTiming(a.id, rects)
    rects.forEach((r, i) => {
      const d = document.createElement('div')
      d.className = `anno-ov anno-ov-${a.type}${activeId === a.id ? ' active' : ''}${sweep ? ' sweep' : ''}`
      if (sweep) {
        d.style.animationDelay = `${sweep[i].delay}ms`
        d.style.animationDuration = `${sweep[i].dur}ms`
      }
      d.dataset.annoId = a.id
      d.style.left = `${r.x}px`
      d.style.top = `${r.y}px`
      d.style.width = `${r.w}px`
      d.style.height = `${r.h}px`
      d.style.setProperty('--c-bg', c.bg)
      d.style.setProperty('--c-line', c.line)
      if (a.type === 'comment' && a.note_text) d.title = a.note_text
      overlayEl.appendChild(d)
    })
  }
  return { orphaned, rectsById }
}

/** Find the annotation whose painted rects contain a local point (topmost). */
export function hitTest(rectsById: Map<string, LocalRect[]>, x: number, y: number): string | null {
  let hit: string | null = null
  for (const [id, rects] of rectsById) {
    for (const r of rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) hit = id
    }
  }
  return hit
}
