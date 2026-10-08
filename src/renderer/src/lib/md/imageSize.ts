import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// Image display width lives in the alt text: ![说明|400](src). The number is CSS
// pixels at 100 % zoom; the editor multiplies it by --doc-font-scale, so a sized
// image zooms with the text around it.

export const MIN_IMAGE_WIDTH = 50

/** Split `说明|400` into the caption and the width (null when there is none). */
export function parseImageAlt(raw: string): { alt: string; width: number | null } {
  const m = /^(.*?)\s*\|\s*(\d{1,5})\s*$/.exec(raw)
  if (!m) return { alt: raw, width: null }
  const w = +m[2]
  return { alt: m[1], width: w > 0 ? w : null }
}

/**
 * The Image node at / next to `pos`, with the range of its alt text. `side` 1
 * looks first at the node starting at pos (a widget that replaces the image),
 * -1 at the one ending there (a widget shown after the revealed source).
 */
export function imageAt(state: EditorState, pos: number, side: 1 | -1 = 1): { from: number; to: number; altFrom: number; altTo: number } | null {
  const tree = syntaxTree(state)
  for (const s of side === 1 ? ([1, -1] as const) : ([-1, 1] as const)) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, s); n; n = n.parent) {
      if (n.name !== 'Image') continue
      const marks = n.getChildren('LinkMark')
      if (marks.length < 2) return null
      return { from: n.from, to: n.to, altFrom: marks[0].to, altTo: marks[1].from }
    }
  }
  return null
}

/** Start positions of the Image nodes on the line containing `pos`, in order. */
export function imagesOnLine(state: EditorState, pos: number): number[] {
  const line = state.doc.lineAt(pos)
  const out: number[] = []
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (n.name === 'Image') {
        out.push(n.from)
        return false
      }
      return true
    }
  })
  return out
}

/**
 * Write (or remove, with null) the |width of the image at `pos`. Only the
 * width text changes: an existing number is replaced digit-for-digit, a
 * missing one is appended before the closing bracket.
 */
export function setImageWidth(view: EditorView, pos: number, width: number | null, side: 1 | -1 = 1): boolean {
  const img = imageAt(view.state, pos, side)
  if (!img) return false
  const raw = view.state.sliceDoc(img.altFrom, img.altTo)
  const m = /\s*\|\s*(\d{1,5})\s*$/.exec(raw)
  let change: { from: number; to: number; insert: string } | null = null
  if (m && width != null) {
    const digitsFrom = img.altFrom + m.index + m[0].lastIndexOf(m[1])
    change = { from: digitsFrom, to: digitsFrom + m[1].length, insert: String(width) }
  } else if (m) change = { from: img.altFrom + m.index, to: img.altTo, insert: '' }
  else if (width != null) change = { from: img.altTo, to: img.altTo, insert: `|${width}` }
  if (!change || view.state.sliceDoc(change.from, change.to) === change.insert) return false
  view.dispatch({ changes: change, userEvent: 'input.resize' })
  return true
}

/** The document zoom factor (--doc-font-scale) in effect at `el`. */
export function zoomAt(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--doc-font-scale'))
  return v > 0 ? v : 1
}

/** Width of the reading area in 100 %-zoom pixels (what a |width is measured in). */
export function readingWidth(view: EditorView): number {
  return Math.max(MIN_IMAGE_WIDTH, Math.floor(view.contentDOM.clientWidth / zoomAt(view.contentDOM)))
}

export const clampWidth = (w: number, view: EditorView): number => Math.round(Math.max(MIN_IMAGE_WIDTH, Math.min(readingWidth(view), w)))

/**
 * Default width for a pasted screenshot: its pixel width over the screen's
 * devicePixelRatio (the size it had on screen), capped at the reading width.
 * Null when the image cannot be decoded.
 */
export async function pastedImageWidth(file: Blob, view: EditorView): Promise<number | null> {
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width
    bmp.close()
    if (!w) return null
    return clampWidth(w / (window.devicePixelRatio || 1), view)
  } catch {
    return null
  }
}
