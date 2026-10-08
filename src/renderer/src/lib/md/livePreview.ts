import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { highlightCode, renderMath } from './render'
import { parseImageAlt } from './imageSize'
import {
  BulletWidget,
  OrderWidget,
  CheckboxWidget,
  HrWidget,
  CodeHeadWidget,
  SpacerWidget,
  InlineMathWidget,
  BlockMathWidget,
  TableWidget,
  MermaidWidget,
  ImageWidget,
  ImageLineWidget,
  splitRow,
  type ImageSpec
} from './widgets'

// Live preview in the Obsidian manner: the document is the markdown source,
// untouched; everything below is decoration. Syntax is hidden (replaced by
// nothing or by a widget) unless the selection is on it, in which case the raw
// characters show in the secondary text colour.
//
//  - inline + line decorations: a view plugin over the visible ranges only
//  - multi-line replacements (tables, $$ maths, mermaid): a state field, since
//    CodeMirror only accepts block-level replacements from state

export type RenderMode = 'live' | 'source' | 'rendered'

export const setRenderMode = StateEffect.define<RenderMode>()
export const renderModeField = StateField.define<RenderMode>({
  create: () => 'live',
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRenderMode)) v = e.value
    return v
  }
})

const setFocused = StateEffect.define<boolean>()
const focusField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) v = e.value
    return v
  }
})

/** Syntax near the selection is revealed only while editing live with focus. */
function revealing(state: EditorState): boolean {
  return state.field(renderModeField) === 'live' && state.field(focusField)
}
function touches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true
  return false
}
function onLines(state: EditorState, from: number, to: number): boolean {
  const a = state.doc.lineAt(from).from
  const b = state.doc.lineAt(to).to
  return touches(state, a, b)
}

const hide = Decoration.replace({})
const syntaxMark = Decoration.mark({ class: 'cm-md-syntax' })

// ---- block-level: tables, display maths, mermaid ------------------------------
interface SpecialBlock {
  from: number
  to: number
  kind: 'table' | 'math' | 'mermaid' | 'image'
  replaced: boolean
}
interface BlockState {
  decos: DecorationSet
  blocks: SpecialBlock[]
}

function codeInfo(node: SyntaxNode, state: EditorState): string {
  const info = node.getChild('CodeInfo')
  return info ? state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] : ''
}

function mathTex(node: SyntaxNode, state: EditorState): string {
  const marks = node.getChildren('BlockMathMark')
  const from = marks[0]?.to ?? node.from
  const to = marks.length > 1 ? marks[marks.length - 1].from : node.to
  return state
    .sliceDoc(from, to)
    .split('\n')
    .map((l) => l.replace(/^\s*(?:>\s?)*/, ''))
    .join('\n')
    .trim()
}

/** src / caption / |width of an Image node. */
function imageSpec(node: SyntaxNode, state: EditorState): ImageSpec {
  const url = node.getChild('URL')
  const marks = node.getChildren('LinkMark')
  // ![说明|400](src): the |400 is the display width, not part of the caption
  const { alt, width } = parseImageAlt(marks.length > 1 ? state.sliceDoc(marks[0].to, marks[1].from) : '')
  return { src: url ? state.sliceDoc(url.from, url.to) : '', alt, width }
}

function computeBlocks(state: EditorState): BlockState {
  const mode = state.field(renderModeField)
  const ranges: Range<Decoration>[] = []
  const blocks: SpecialBlock[] = []
  if (mode === 'source') return { decos: Decoration.none, blocks }
  const reveal = revealing(state)
  const doc = state.doc
  syntaxTree(state).iterate({
    enter: (n) => {
      switch (n.name) {
        case 'Document':
        case 'Blockquote':
        case 'BulletList':
        case 'OrderedList':
        case 'ListItem':
          return true
        case 'Table': {
          const from = doc.lineAt(n.from).from
          const to = doc.lineAt(n.to).to
          const active = reveal && touches(state, from, to)
          if (!active) ranges.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to)), block: true }).range(from, to))
          blocks.push({ from, to, kind: 'table', replaced: !active })
          return false
        }
        case 'BlockMath': {
          const from = doc.lineAt(n.from).from
          const to = doc.lineAt(n.to).to
          const tex = mathTex(n.node, state)
          const res = renderMath(tex, true)
          const active = reveal && touches(state, from, to)
          const replace = !active && !res.error && tex !== ''
          if (replace) ranges.push(Decoration.replace({ widget: new BlockMathWidget(tex), block: true }).range(from, to))
          else {
            for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) {
              const line = doc.line(l)
              ranges.push(
                Decoration.line({
                  class: `cm-md-mathsrc${res.error ? ' cm-md-math-error' : ''}`,
                  attributes: res.error ? { title: `公式有误:${res.error}` } : {}
                }).range(line.from)
              )
            }
            if (active && !res.error && tex) ranges.push(Decoration.widget({ widget: new BlockMathWidget(tex, true), block: true, side: 1 }).range(to))
          }
          blocks.push({ from, to, kind: 'math', replaced: replace })
          return false
        }
        case 'Paragraph': {
          // a top-level line holding only image(s) becomes one block: no line box of
          // its own, so image↔text and image↔image gaps are the plain paragraph gap
          if (n.node.parent?.name !== 'Document') return false
          const imgs = n.node.getChildren('Image')
          if (!imgs.length) return false
          for (let l = doc.lineAt(n.from).number; l <= doc.lineAt(n.to).number; l++) {
            const line = doc.line(l)
            const onLine = imgs.filter((im) => im.from >= line.from && im.to <= line.to)
            if (!onLine.length) continue
            let rest = line.text
            for (const im of [...onLine].reverse()) rest = rest.slice(0, im.from - line.from) + rest.slice(im.to - line.from)
            if (rest.trim()) continue
            const images = onLine.map((im) => imageSpec(im, state))
            const active = reveal && touches(state, line.from, line.to)
            if (active) ranges.push(Decoration.widget({ widget: new ImageLineWidget(images, true), block: true, side: 1 }).range(line.to))
            else ranges.push(Decoration.replace({ widget: new ImageLineWidget(images), block: true }).range(line.from, line.to))
            blocks.push({ from: line.from, to: line.to, kind: 'image', replaced: !active })
          }
          return false
        }
        case 'FencedCode': {
          if (codeInfo(n.node, state).toLowerCase() === 'mermaid') {
            const from = doc.lineAt(n.from).from
            const to = doc.lineAt(n.to).to
            const active = reveal && touches(state, from, to)
            const marks = n.node.getChildren('CodeMark')
            const closed = marks.length > 1
            if (!active && closed) {
              const code = state.sliceDoc(doc.lineAt(n.from).to + 1, doc.lineAt(marks[marks.length - 1].from).from - 1)
              ranges.push(Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(from, to))
              blocks.push({ from, to, kind: 'mermaid', replaced: true })
            }
          }
          return false
        }
        default:
          return false
      }
    }
  })
  return { decos: Decoration.set(ranges, true), blocks }
}

const blockField = StateField.define<BlockState>({
  create: (state) => computeBlocks(state),
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    const modeChanged = tr.effects.some((e) => e.is(setRenderMode) || e.is(setFocused))
    if (!tr.docChanged && !tr.selection && !treeChanged && !modeChanged) return value
    return computeBlocks(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos)
})

// ---- inline + line decorations (visible ranges only) -------------------------
const INLINE_MARKS: Record<string, string> = {
  EmphasisMark: 'Emphasis|StrongEmphasis',
  StrikethroughMark: 'Strikethrough',
  HighlightMark: 'Highlight'
}
const NODE_CLASS: Record<string, string> = {
  Emphasis: 'cm-md-em',
  StrongEmphasis: 'cm-md-strong',
  Strikethrough: 'cm-md-strike',
  Highlight: 'cm-md-mark'
}

let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 8
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

function listDepth(node: SyntaxNode): number {
  let d = 0
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++
  return d
}

function buildInline(view: EditorView): DecorationSet {
  const { state } = view
  const mode = state.field(renderModeField)
  const ranges: Range<Decoration>[] = []
  const lineCls = new Map<number, Set<string>>()
  const lineStyle = new Map<number, string>()
  const addLine = (pos: number, cls: string): void => {
    const from = state.doc.lineAt(pos).from
    let s = lineCls.get(from)
    if (!s) lineCls.set(from, (s = new Set()))
    s.add(cls)
  }
  const eachLine = (from: number, to: number, fn: (lineFrom: number, i: number) => void): void => {
    const a = state.doc.lineAt(from).number
    const b = state.doc.lineAt(to).number
    for (let l = a; l <= b; l++) fn(state.doc.line(l).from, l - a)
  }
  const tree = syntaxTree(state)
  const doc = state.doc

  // source mode: plain text in the reading face; code blocks stay monospace
  if (mode === 'source') {
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (n) => {
          if (n.name === 'FencedCode' || n.name === 'CodeBlock') {
            eachLine(n.from, n.to, (lf) => addLine(lf, 'cm-md-srccode'))
            return false
          }
          if (n.name === 'BlockMath') {
            eachLine(n.from, n.to, (lf) => addLine(lf, 'cm-md-srccode'))
            return false
          }
          return true
        }
      })
    }
    return finish()
  }

  const reveal = revealing(state)
  const blocks = state.field(blockField).blocks
  const replacedAt = (from: number, to: number): boolean => blocks.some((b) => b.replaced && from >= b.from && to <= b.to)
  const seen = new Set<string>()
  const font = (): string => {
    const cs = getComputedStyle(view.contentDOM)
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  }
  let fontCache: string | null = null

  const hideSpan = (from: number, to: number): void => {
    if (to > from) ranges.push(hide.range(from, to))
  }
  const trailingSpace = (pos: number): number => {
    const c = doc.sliceString(pos, pos + 1)
    return c === ' ' || c === '\t' ? 1 : 0
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (n: SyntaxNodeRef) => {
        if (n.name === 'Document') return true
        if (replacedAt(n.from, n.to)) return false
        const key = `${n.name}:${n.from}:${n.to}`
        if (seen.has(key)) return false
        seen.add(key)
        const node = n.node
        switch (n.name) {
          case 'Blockquote':
            eachLine(n.from, n.to, (lf) => addLine(lf, 'cm-md-quote'))
            return true
          case 'QuoteMark':
            if (reveal && touches(state, n.from, n.to + 1)) ranges.push(syntaxMark.range(n.from, n.to))
            else hideSpan(n.from, n.to + trailingSpace(n.to))
            return false
          case 'BulletList':
          case 'OrderedList':
            return true
          case 'ListItem': {
            const depth = listDepth(node)
            eachLine(n.from, n.to, (lf, i) => {
              addLine(lf, 'cm-md-li')
              if (i === 0) addLine(lf, 'cm-md-li-first')
              lineStyle.set(lf, `--li-depth:${depth}`)
            })
            return true
          }
          case 'ListMark': {
            const item = node.parent
            const task = item?.getChild('Task')
            const tm = task?.getChild('TaskMarker')
            const line = doc.lineAt(n.from)
            let ws = n.from
            while (ws > line.from && /[ \t]/.test(doc.sliceString(ws - 1, ws))) ws--
            const end = n.to + trailingSpace(n.to)
            if (reveal && touches(state, ws, tm ? tm.to : end)) {
              ranges.push(Decoration.mark({ class: 'cm-md-syntax cm-md-listmark' }).range(n.from, n.to))
              return false
            }
            hideSpan(ws, n.from)
            if (tm) hideSpan(n.from, end)
            else if (item?.parent?.name === 'OrderedList') ranges.push(Decoration.replace({ widget: new OrderWidget(doc.sliceString(n.from, n.to)) }).range(n.from, end))
            else ranges.push(Decoration.replace({ widget: new BulletWidget(listDepth(item ?? node)) }).range(n.from, end))
            return false
          }
          case 'Task':
            return true
          case 'TaskMarker': {
            const item = node.parent?.parent
            const lm = item?.getChild('ListMark')
            if (reveal && touches(state, lm ? lm.from : n.from, n.to)) {
              ranges.push(syntaxMark.range(n.from, n.to))
              return false
            }
            const checked = /x/i.test(doc.sliceString(n.from + 1, n.to - 1))
            ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(n.from, n.to + trailingSpace(n.to)))
            if (checked) addLine(n.from, 'cm-md-task-done')
            return false
          }
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6':
            addLine(n.from, `cm-md-h cm-md-h${n.name.slice(-1)}`)
            return true
          case 'SetextHeading1':
          case 'SetextHeading2': {
            const lvl = n.name.slice(-1)
            const mark = node.getChild('HeaderMark')
            eachLine(n.from, mark ? mark.from - 1 : n.to, (lf) => addLine(lf, `cm-md-h cm-md-h${lvl}`))
            return true
          }
          case 'HeaderMark': {
            const parent = node.parent
            if (parent?.name.startsWith('Setext')) {
              if (reveal && onLines(state, n.from, n.to)) ranges.push(syntaxMark.range(n.from, n.to))
              else {
                hideSpan(n.from, n.to)
                addLine(n.from, 'cm-md-collapsed')
              }
              return false
            }
            if (reveal && onLines(state, n.from, n.to)) {
              ranges.push(syntaxMark.range(n.from, n.to))
              return false
            }
            const line = doc.lineAt(n.from)
            if (n.from === (parent?.from ?? line.from)) hideSpan(n.from, Math.min(line.to, n.to + trailingSpace(n.to)))
            else {
              let s = n.from
              while (s > line.from && /[ \t]/.test(doc.sliceString(s - 1, s))) s--
              hideSpan(s, n.to)
            }
            return false
          }
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
          case 'Highlight':
            ranges.push(Decoration.mark({ class: NODE_CLASS[n.name] }).range(n.from, n.to))
            return true
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HighlightMark': {
            const p = node.parent
            if (!p || !INLINE_MARKS[n.name].split('|').includes(p.name)) return false
            if (reveal && touches(state, p.from, p.to)) ranges.push(syntaxMark.range(n.from, n.to))
            else hideSpan(n.from, n.to)
            return false
          }
          case 'InlineCode': {
            const marks = node.getChildren('CodeMark')
            const a = marks[0]?.to ?? n.from
            const b = marks.length > 1 ? marks[marks.length - 1].from : n.to
            const active = reveal && touches(state, n.from, n.to)
            if (b > a) ranges.push(Decoration.mark({ tagName: 'code', class: 'cm-md-code' }).range(a, b))
            for (const m of marks) {
              if (active) ranges.push(syntaxMark.range(m.from, m.to))
              else hideSpan(m.from, m.to)
            }
            return false
          }
          case 'Link': {
            const marks = node.getChildren('LinkMark')
            const url = node.getChild('URL')
            const href = url ? doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : ''
            const active = reveal && touches(state, n.from, n.to)
            const open = marks[0]
            const close = marks[1]
            if (open && close && close.from > open.to) {
              ranges.push(
                Decoration.mark({
                  class: 'cm-md-link',
                  attributes: href ? { 'data-href': href, title: `Ctrl+点击打开 ${href}` } : {}
                }).range(open.to, close.from)
              )
            }
            if (active) {
              for (const m of marks) ranges.push(syntaxMark.range(m.from, m.to))
              if (url) ranges.push(Decoration.mark({ class: 'cm-md-syntax cm-md-url' }).range(url.from, url.to))
              const title = node.getChild('LinkTitle')
              if (title) ranges.push(syntaxMark.range(title.from, title.to))
            } else if (open && close) {
              hideSpan(open.from, open.to)
              hideSpan(close.from, n.to)
            }
            // the label may hold emphasis / code: descend, marks handled above
            node.getChildren('LinkMark').forEach((m) => seen.add(`LinkMark:${m.from}:${m.to}`))
            if (url) seen.add(`URL:${url.from}:${url.to}`)
            return true
          }
          case 'Autolink': {
            const url = node.getChild('URL')
            const active = reveal && touches(state, n.from, n.to)
            if (url) {
              const href = doc.sliceString(url.from, url.to)
              ranges.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': href, title: `Ctrl+点击打开 ${href}` } }).range(url.from, url.to))
            }
            for (const m of node.getChildren('LinkMark')) {
              if (active) ranges.push(syntaxMark.range(m.from, m.to))
              else hideSpan(m.from, m.to)
            }
            return false
          }
          case 'URL': {
            // bare (GFM autolink) URL in running text
            const href = doc.sliceString(n.from, n.to)
            const full = /^www\./i.test(href) ? `https://${href}` : href
            ranges.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': full, title: `Ctrl+点击打开 ${full}` } }).range(n.from, n.to))
            return false
          }
          case 'Image': {
            // image-only lines are blocks (blockField): replaced, or revealed source above the block
            const own = blocks.find((b) => b.kind === 'image' && n.from >= b.from && n.to <= b.to)
            if (own) {
              if (!own.replaced) ranges.push(syntaxMark.range(n.from, n.to))
              return false
            }
            const { src, alt, width } = imageSpec(node, state)
            const active = reveal && touches(state, n.from, n.to)
            if (active) {
              ranges.push(Decoration.mark({ class: 'cm-md-syntax' }).range(n.from, n.to))
              ranges.push(Decoration.widget({ widget: new ImageWidget(src, alt, width, true), side: 1 }).range(n.to))
            } else ranges.push(Decoration.replace({ widget: new ImageWidget(src, alt, width) }).range(n.from, n.to))
            return false
          }
          case 'InlineMath': {
            const tex = doc.sliceString(n.from + 1, n.to - 1)
            const res = renderMath(tex, false)
            const active = reveal && touches(state, n.from, n.to)
            if (!active && res.html) ranges.push(Decoration.replace({ widget: new InlineMathWidget(tex) }).range(n.from, n.to))
            else
              ranges.push(
                Decoration.mark({
                  class: `cm-md-mathsrc-inline${res.error ? ' cm-md-math-error' : ''}`,
                  attributes: res.error ? { title: `公式有误:${res.error}` } : {}
                }).range(n.from, n.to)
              )
            return false
          }
          case 'HorizontalRule':
            if (reveal && onLines(state, n.from, n.to)) ranges.push(syntaxMark.range(n.from, n.to))
            else ranges.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to))
            return false
          case 'FencedCode': {
            const marks = node.getChildren('CodeMark')
            const open = doc.lineAt(n.from)
            const closeMark = marks.length > 1 ? marks[marks.length - 1] : null
            const close = closeMark ? doc.lineAt(closeMark.from) : null
            const active = reveal && touches(state, n.from, n.to)
            const lang = codeInfo(node, state)
            addLine(open.from, active ? 'cm-md-fence-open cm-md-fence-active' : 'cm-md-fence-open')
            if (close) addLine(close.from, active ? 'cm-md-fence-close cm-md-fence-active' : 'cm-md-fence-close')
            const lastContent = close ? close.number - 1 : doc.lineAt(n.to).number
            for (let l = open.number + 1; l <= lastContent; l++) addLine(doc.line(l).from, 'cm-md-codeline')
            if (!close) addLine(doc.lineAt(n.to).from, 'cm-md-codeline-last')
            if (active) {
              ranges.push(Decoration.mark({ class: 'cm-md-syntax cm-md-fence-text' }).range(marks[0].from, open.to))
              if (closeMark) ranges.push(syntaxMark.range(closeMark.from, closeMark.to))
            } else {
              ranges.push(Decoration.replace({ widget: new CodeHeadWidget(lang) }).range(marks[0].from, open.to))
              if (closeMark) hideSpan(closeMark.from, closeMark.to)
            }
            // highlight.js tokens (only for blocks not nested in a quote/list)
            if (lang && open.number < lastContent && marks[0].from === open.from) {
              const cFrom = doc.line(open.number + 1).from
              const cTo = doc.line(lastContent).to
              for (const t of highlightCode(doc.sliceString(cFrom, cTo), lang)) {
                const a = cFrom + t.from
                const b = cFrom + t.to
                if (b < from || a > to) continue
                ranges.push(Decoration.mark({ class: t.cls }).range(a, b))
              }
            }
            return false
          }
          case 'CodeBlock':
            eachLine(n.from, n.to, (lf) => addLine(lf, 'cm-md-codeline cm-md-indented'))
            return false
          case 'Table': {
            // active table: raw source, columns aligned visually with spacers
            fontCache ??= font()
            const first = doc.lineAt(n.from).number
            const last = doc.lineAt(n.to).number
            const rows: { line: number; cells: { from: number; to: number; w: number }[] }[] = []
            const widths: number[] = []
            for (let l = first; l <= last; l++) {
              const line = doc.line(l)
              addLine(line.from, 'cm-md-table-src')
              const cells = splitRow(line.text).map((c) => ({ from: line.from + c.from, to: line.from + c.to, w: textWidth(c.text, fontCache!) }))
              cells.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.w)))
              rows.push({ line: l, cells })
            }
            for (const r of rows)
              r.cells.forEach((c, i) => {
                const gap = widths[i] - c.w
                if (gap > 0.5) ranges.push(Decoration.widget({ widget: new SpacerWidget(gap), side: -1 }).range(c.to))
              })
            return false
          }
          case 'BlockMath':
            return false
          case 'Escape':
            if (!(reveal && touches(state, n.from, n.to))) hideSpan(n.from, n.from + 1)
            return false
          case 'HTMLTag':
          case 'HTMLBlock':
          case 'Comment':
          case 'CommentBlock':
            ranges.push(Decoration.mark({ class: 'cm-md-html' }).range(n.from, n.to))
            return false
          default:
            return true
        }
      }
    })
  }

  // Image widgets supply their own line-leading. Collapse adjacent blank runs
  // visually, leaving the original markdown and focused editing lines intact.
  const imageGaps = new Set<number>()
  for (const block of blocks) {
    if (block.kind !== 'image') continue
    for (const step of [-1, 1]) {
      let n = doc.lineAt(step < 0 ? block.from : block.to).number + step
      while (n > 0 && n <= doc.lines && !doc.line(n).text.trim()) {
        if (imageGaps.has(n)) break
        imageGaps.add(n)
        n += step
      }
    }
  }

  // Ordinary blank lines retain their existing paragraph rhythm.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      if (!line.text.trim() && !lineCls.get(line.from)?.size && !replacedAt(line.from, line.to)) {
        if (!(reveal && touches(state, line.from, line.to)))
          addLine(line.from, imageGaps.has(line.number) ? 'cm-md-collapsed' : 'cm-md-gap')
      }
      pos = line.to + 1
    }
  }
  return finish()

  function finish(): DecorationSet {
    for (const [pos, set] of lineCls) {
      const style = lineStyle.get(pos)
      ranges.push(Decoration.line({ class: [...set].join(' '), attributes: style ? { style } : undefined }).range(pos))
    }
    return Decoration.set(ranges, true)
  }
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate): void {
      const modeChanged = u.transactions.some((t) => t.effects.some((e) => e.is(setRenderMode) || e.is(setFocused)))
      if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged || u.geometryChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = buildInline(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/** Ctrl/Cmd+click on a rendered link opens it in the system browser. */
const linkClicks = EditorView.domEventHandlers({
  mousedown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
    const el = (e.target as HTMLElement).closest('[data-href]') as HTMLElement | null
    const href = el?.dataset.href
    if (!href || !/^https?:\/\//i.test(href)) return false
    e.preventDefault()
    window.api.app.openExternal(href)
    return true
  }
})

export function livePreview(): Extension {
  return [
    renderModeField,
    focusField,
    EditorView.focusChangeEffect.of((_s, focusing) => setFocused.of(focusing)),
    blockField,
    inlinePlugin,
    linkClicks
  ]
}
