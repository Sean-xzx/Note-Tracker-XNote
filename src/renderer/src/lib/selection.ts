// Unified selection → anchor interface. Given the user's current selection,
// produce a stable anchor: the selected text, surrounding context, and a
// position locator. This is the substrate for Step 2's annotation anchors
// (mixed anchor: text + context + position). No annotation UI here.

export interface DocAnchor {
  text: string
  prefix: string
  suffix: string
  locator:
    | { type: 'text'; start: number; end: number }
    | { type: 'pdf'; page: number; start: number; end: number }
}

const CONTEXT = 32

/** Anchor from a textarea's current selection (editable text substrates). */
export function textareaAnchor(el: HTMLTextAreaElement): DocAnchor | null {
  const start = el.selectionStart
  const end = el.selectionEnd
  if (start === end) return null
  const full = el.value
  return {
    text: full.slice(start, end),
    prefix: full.slice(Math.max(0, start - CONTEXT), start),
    suffix: full.slice(end, end + CONTEXT),
    locator: { type: 'text', start, end }
  }
}

function ancestor(
  node: Node | null,
  pred: (el: HTMLElement) => boolean
): HTMLElement | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    if (pred(el)) return el
    el = el.parentElement
  }
  return el
}

/** Character offset of (node, nodeOffset) within root's text content. */
function offsetWithin(root: HTMLElement, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === node) return count + nodeOffset
    count += n.textContent?.length ?? 0
  }
  return count
}

/**
 * Compute an anchor from the current window selection.
 *  - kind 'text': offsets are character positions within the `.doc-substrate`.
 *  - kind 'pdf' : locator is page number + text-layer item index range.
 * Returns null if there is no usable (non-empty) selection.
 */
export function computeAnchor(kind: 'text' | 'pdf'): DocAnchor | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const text = sel.toString()
  if (!text.trim()) return null

  if (kind === 'text') {
    const root = ancestor(range.startContainer, (e) => e.classList.contains('doc-substrate'))
    if (!root) return null
    const start = offsetWithin(root, range.startContainer, range.startOffset)
    const end = offsetWithin(root, range.endContainer, range.endOffset)
    const full = root.textContent ?? ''
    return {
      text,
      prefix: full.slice(Math.max(0, start - CONTEXT), start),
      suffix: full.slice(end, end + CONTEXT),
      locator: { type: 'text', start, end }
    }
  }

  // pdf
  const layer = ancestor(range.startContainer, (e) => e.classList.contains('textLayer'))
  if (!layer) return null
  const pageEl = layer.closest('.pdf-page') as HTMLElement | null
  const page = pageEl ? parseInt(pageEl.getAttribute('data-page') ?? '0', 10) : 0
  const start = offsetWithin(layer, range.startContainer, range.startOffset)
  const end = offsetWithin(layer, range.endContainer, range.endOffset)
  const full = layer.textContent ?? ''
  return {
    text,
    prefix: full.slice(Math.max(0, start - CONTEXT), start),
    suffix: full.slice(end, end + CONTEXT),
    locator: { type: 'pdf', page, start, end }
  }
}
