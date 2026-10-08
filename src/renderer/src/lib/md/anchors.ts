import type { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { AnnoAnchor, Annotation } from '../../../../preload'
import { locateInText } from '../annoRender'

// Anchors of markdown text annotations are source positions: UTF-16 offsets
// into the .md text + the source quote + 32 chars of context either side.
// After an edit the anchor is re-found by its quote and context; the display
// quote (annotation.quote) is the rendered text, without markdown syntax.

const CONTEXT = 32

/** Nodes whose characters never appear in the rendered text. */
const HIDDEN = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'QuoteMark',
  'ListMark',
  'TaskMarker',
  'StrikethroughMark',
  'LinkMark',
  'LinkTitle',
  'LinkLabel',
  'TableDelimiter',
  'HorizontalRule',
  'HTMLTag',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction'
])
/** Extra syntax only the live editor renders (the old marked preview showed it literally). */
const HIDDEN_LIVE = new Set(['HighlightMark', 'InlineMathMark', 'BlockMathMark'])

let decoder: HTMLTextAreaElement | null = null
function decodeEntity(s: string): string {
  decoder ??= document.createElement('textarea')
  decoder.innerHTML = s
  return decoder.value
}

interface Visible {
  /** whitespace-collapsed visible text */
  text: string
  /** for each char of `text`: its source [from, to) */
  from: number[]
  to: number[]
}

/**
 * The rendered text of [from, to) of the source with its source mapping.
 * `legacy` reproduces the old marked preview (no maths / ==highlight==).
 */
export function visibleText(state: EditorState, from: number, to: number, legacy: boolean): Visible {
  const tree = ensureSyntaxTree(state, to, 400) ?? syntaxTree(state)
  const src = state.sliceDoc(from, to)
  const hidden = new Uint8Array(src.length)
  const subst = new Map<number, { text: string; end: number }>()
  const mark = (a: number, b: number): void => {
    for (let i = Math.max(a, from); i < Math.min(b, to); i++) hidden[i - from] = 1
  }
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (HIDDEN.has(n.name) || (!legacy && HIDDEN_LIVE.has(n.name))) {
        mark(n.from, n.to)
        return false
      }
      if (n.name === 'URL' && n.node.parent && ['Link', 'Image'].includes(n.node.parent.name)) {
        mark(n.from, n.to)
        return false
      }
      if (n.name === 'Image') {
        mark(n.from, n.to)
        return false
      }
      if (n.name === 'Escape') {
        mark(n.from, n.from + 1)
        return false
      }
      if (n.name === 'Entity' && n.from >= from && n.to <= to) {
        const d = decodeEntity(state.sliceDoc(n.from, n.to))
        subst.set(n.from, { text: d, end: n.to })
        mark(n.from + 1, n.to)
        return false
      }
      return true
    }
  })
  let text = ''
  const f: number[] = []
  const t: number[] = []
  let ws = true
  for (let i = 0; i < src.length; i++) {
    if (hidden[i]) continue
    const pos = from + i
    const sub = subst.get(pos)
    const chunk = sub ? sub.text : src[i]
    const end = sub ? sub.end : pos + 1
    for (const ch of chunk) {
      if (/\s/.test(ch)) {
        if (ws) continue
        ws = true
        text += ' '
      } else {
        ws = false
        text += ch
      }
      f.push(pos)
      t.push(end)
    }
  }
  return { text, from: f, to: t }
}

/** Display quote for a source range: the words as rendered, trimmed. */
export function plainQuote(state: EditorState, from: number, to: number): string {
  return visibleText(state, from, to, false).text.trim()
}

export function mdAnchor(state: EditorState, from: number, to: number): AnnoAnchor {
  return {
    text: state.sliceDoc(from, to),
    prefix: state.sliceDoc(Math.max(0, from - CONTEXT), from),
    suffix: state.sliceDoc(to, Math.min(state.doc.length, to + CONTEXT)),
    locator: { type: 'md', start: from, end: to }
  }
}

/** Find an md anchor in the current source: exact position first, then quote + context. */
export function relocate(src: string, a: AnnoAnchor): { from: number; to: number } | null {
  const loc = a.locator
  if (loc.type === 'md' && src.slice(loc.start, loc.end) === a.text && a.text) return { from: loc.start, to: loc.end }
  if (!a.text) return null
  const i = locateInText(src, a.text, a.prefix, a.suffix)
  return i < 0 ? null : { from: i, to: i + a.text.length }
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ')

/**
 * Migrate an annotation made before the live editor. Its locator is 'text':
 *  - made in the old 源码 view → offsets are already source offsets (checked by
 *    comparing the slice with the quote);
 *  - made in the old 预览 → offsets/quote/context refer to the rendered text of
 *    marked. We rebuild that rendered text from the syntax tree with a map back
 *    to the source, find the quote there (context disambiguates), and convert.
 * Returns null when it cannot be placed (it then shows under 失配).
 */
export function migrateLegacy(
  state: EditorState,
  a: Annotation,
  cache: { vis?: Visible }
): { anchor: AnnoAnchor; quote: string } | null {
  const loc = a.anchor.locator
  if (loc.type !== 'text') return null
  const src = state.doc.toString()
  const quote = a.anchor.text || a.quote
  if (!quote) return null
  if (src.slice(loc.start, loc.end) === quote) return { anchor: mdAnchor(state, loc.start, loc.end), quote: a.quote }

  cache.vis ??= visibleText(state, 0, state.doc.length, true)
  const vis = cache.vis
  const q = collapse(quote).trim()
  if (q) {
    const i = locateInText(vis.text, q, collapse(a.anchor.prefix), collapse(a.anchor.suffix))
    if (i >= 0) {
      const from = vis.from[i]
      const to = vis.to[i + q.length - 1]
      return { anchor: mdAnchor(state, from, to), quote: a.quote }
    }
  }
  const j = locateInText(src, quote, a.anchor.prefix, a.anchor.suffix)
  if (j >= 0) return { anchor: mdAnchor(state, j, j + quote.length), quote: a.quote }
  return null
}
