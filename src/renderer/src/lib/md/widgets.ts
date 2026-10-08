import { EditorView, WidgetType } from '@codemirror/view'
import { renderMath, renderMermaid, inlineHtml, resolveImageSrc } from './render'
import { clampWidth, imagesOnLine, setImageWidth, zoomAt } from './imageSize'

// Display-only widgets. They never own text: every one of them stands in for a
// range of the markdown source, which stays the single source of truth.

const BULLETS = ['•', '◦', '▪']

export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super()
  }
  eq(o: BulletWidget): boolean {
    return o.depth === this.depth
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = BULLETS[(this.depth - 1) % BULLETS.length]
    return s
  }
}

export class OrderWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(o: OrderWidget): boolean {
    return o.label === this.label
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-olnum'
    s.textContent = this.label
    return s
  }
}

/** `[ ]` / `[x]`: clicking flips exactly the one character between the brackets. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(o: CheckboxWidget): boolean {
    return o.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-task'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.tabIndex = -1
    box.setAttribute('aria-label', this.checked ? '已完成' : '未完成')
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      const pos = view.posAtDOM(wrap)
      const ch = view.state.sliceDoc(pos + 1, pos + 2)
      if (view.state.sliceDoc(pos, pos + 1) !== '[') return
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: ch === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' })
    })
    wrap.appendChild(box)
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    return s
  }
}

/** Code block header: language label (right) standing in for the opening fence. */
export class CodeHeadWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(o: CodeHeadWidget): boolean {
    return o.lang === this.lang
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-codelang code-lang'
    s.textContent = this.lang
    return s
  }
}

export class SpacerWidget extends WidgetType {
  constructor(readonly px: number) {
    super()
  }
  eq(o: SpacerWidget): boolean {
    return Math.abs(o.px - this.px) < 0.5
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-spacer'
    s.style.width = `${this.px}px`
    return s
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super()
  }
  eq(o: InlineMathWidget): boolean {
    return o.tex === this.tex
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-math'
    s.innerHTML = renderMath(this.tex, false).html ?? ''
    return s
  }
}

/** Centred display maths (replaces the $$ block, or previews it under the source). */
export class BlockMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly preview = false
  ) {
    super()
  }
  eq(o: BlockMathWidget): boolean {
    return o.tex === this.tex && o.preview === this.preview
  }
  get estimatedHeight(): number {
    return 60
  }
  toDOM(): HTMLElement {
    const d = document.createElement('div')
    d.className = `cm-md-mathblock chat-md${this.preview ? ' preview-of-source' : ''}`
    d.innerHTML = renderMath(this.tex, true).html ?? ''
    return d
  }
}

export interface TableModel {
  align: ('left' | 'center' | 'right' | null)[]
  head: string[]
  rows: string[][]
}

/** Split one GFM table row into raw cell texts (pipes in code / escaped are kept). */
export function splitRow(line: string): { text: string; from: number; to: number }[] {
  const cells: { text: string; from: number; to: number }[] = []
  let i = 0
  const n = line.length
  while (i < n && /\s/.test(line[i])) i++
  if (line[i] === '|') i++
  let start = i
  let inCode = 0
  for (; i < n; i++) {
    const c = line[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '`') {
      let k = 0
      while (line[i + k] === '`') k++
      if (inCode === 0) inCode = k
      else if (inCode === k) inCode = 0
      i += k - 1
      continue
    }
    if (c === '|' && !inCode) {
      cells.push({ text: line.slice(start, i), from: start, to: i })
      start = i + 1
    }
  }
  const tail = line.slice(start)
  if (tail.trim() !== '' || cells.length === 0) cells.push({ text: tail, from: start, to: n })
  return cells
}

export function parseTable(lines: string[]): TableModel {
  const clean = lines.map((l) => l.replace(/^\s*(?:>\s?)*/, ''))
  const head = splitRow(clean[0] ?? '').map((c) => c.text.trim())
  const align = splitRow(clean[1] ?? '').map((c) => {
    const t = c.text.trim()
    const l = t.startsWith(':')
    const r = t.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  const rows = clean.slice(2).map((l) => splitRow(l).map((c) => c.text.trim()))
  return { align, head, rows }
}

/** A rendered GFM table. Clicking a cell puts the caret into that cell's source. */
export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(o: TableWidget): boolean {
    return o.source === this.source
  }
  get estimatedHeight(): number {
    return 40 * this.source.split('\n').length
  }
  toDOM(view: EditorView): HTMLElement {
    const lines = this.source.split('\n')
    const t = parseTable(lines)
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table table-wrap'
    const cols = Math.max(t.head.length, ...t.rows.map((r) => r.length))
    const cell = (tag: 'th' | 'td', md: string, c: number, r: number): string => {
      const a = t.align[c]
      return `<${tag} data-r="${r}" data-c="${c}"${a ? ` style="text-align:${a}"` : ''}>${inlineHtml(md)}</${tag}>`
    }
    let html = '<table><thead><tr>'
    for (let c = 0; c < cols; c++) html += cell('th', t.head[c] ?? '', c, 0)
    html += '</tr></thead><tbody>'
    t.rows.forEach((row, ri) => {
      html += '<tr>'
      for (let c = 0; c < cols; c++) html += cell('td', row[c] ?? '', c, ri + 2)
      html += '</tr>'
    })
    wrap.innerHTML = html + '</tbody></table>'
    wrap.addEventListener('mousedown', (e) => {
      if (view.state.readOnly || e.button !== 0 || e.ctrlKey || e.metaKey) return
      const td = (e.target as HTMLElement).closest('[data-r]') as HTMLElement | null
      const base = view.posAtDOM(wrap)
      let pos = base
      if (td) {
        const r = Number(td.dataset.r)
        const c = Number(td.dataset.c)
        const line = view.state.doc.lineAt(base)
        const target = line.number + r <= view.state.doc.lines ? view.state.doc.line(line.number + r) : line
        const cells = splitRow(target.text)
        const cc = cells[Math.min(c, cells.length - 1)]
        if (cc) {
          const lead = cc.text.length - cc.text.trimStart().length
          pos = target.from + cc.from + lead + cc.text.trim().length
        } else pos = target.from
      }
      e.preventDefault()
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false, userEvent: 'select.pointer' })
      view.focus()
    })
    return wrap
  }
  ignoreEvent(e: Event): boolean {
    return e.type === 'mousedown'
  }
}

/** Mermaid diagram; falls back to a plain code block when it cannot be drawn. */
export class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  eq(o: MermaidWidget): boolean {
    return o.code === this.code
  }
  get estimatedHeight(): number {
    return 220
  }
  toDOM(view: EditorView): HTMLElement {
    const d = document.createElement('div')
    d.className = 'cm-md-mermaid mermaid-block loading'
    d.textContent = '正在绘制图表…'
    renderMermaid(this.code).then(
      (svg) => {
        d.className = 'cm-md-mermaid mermaid-block'
        d.innerHTML = svg
        view.requestMeasure()
      },
      () => {
        d.className = 'cm-md-mermaid code-block mermaid-fallback'
        const head = document.createElement('div')
        head.className = 'code-head'
        head.innerHTML = '<span class="code-lang">mermaid</span>'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = this.code
        pre.appendChild(code)
        d.replaceChildren(head, pre)
        view.requestMeasure()
      }
    )
    return d
  }
}

// ---- images --------------------------------------------------------------------
export interface ImageSpec {
  src: string
  alt: string
  /** |width from the alt text (100 %-zoom px), null = natural size capped at the column */
  width: number | null
}

// Natural size per loaded URL and last rendered height per (url, width): lets a
// re-created image reserve its box before it decodes, and gives block widgets
// a real estimatedHeight, so nothing collapses and re-expands.
const naturalSize = new Map<string, { w: number; h: number }>()
const renderedHeight = new Map<string, number>()
const sizeKey = (url: string, width: number | null): string => `${width ?? ''}|${url}`

const cssWidth = (w: number): string => `calc(${w}px * var(--doc-font-scale, 1))`

/** The image a size control belongs to: inline widgets sit at the image, block ones replace its line. */
export function imageTarget(view: EditorView, wrap: HTMLElement): { pos: number; side: 1 | -1 } {
  const line = wrap.closest('.cm-md-image-line') as HTMLElement | null
  if (!line) return { pos: view.posAtDOM(wrap), side: wrap.dataset.imageSide === '-1' ? -1 : 1 }
  // n-th image on the source line the block stands for
  const at = view.posAtDOM(line)
  const starts = imagesOnLine(view.state, at)
  const nth = +(wrap.dataset.imageIndex ?? 0)
  return { pos: starts[Math.min(nth, starts.length - 1)] ?? at, side: 1 }
}

/** One image with its hover resize grip. */
function buildImage(view: EditorView, spec: ImageSpec, tag: 'span' | 'div'): HTMLElement {
  const s = document.createElement(tag)
  s.className = 'cm-md-image'
  const url = resolveImageSrc(spec.src)
  const broken = (): void => {
    s.classList.add('broken')
    s.textContent = `图片无法显示${spec.alt ? `:${spec.alt}` : ''}`
    view.requestMeasure()
  }
  if (!url) {
    broken()
    return s
  }
  const img = document.createElement('img')
  img.alt = spec.alt
  img.draggable = false
  // known intrinsic size → the box is reserved before decoding (height:auto keeps the ratio)
  const nat = naturalSize.get(url)
  if (nat) {
    img.width = nat.w
    img.height = nat.h
  }
  // scales with the document zoom; max-width keeps it inside the column
  if (spec.width) img.style.width = cssWidth(spec.width)
  img.addEventListener('load', () => {
    naturalSize.set(url, { w: img.naturalWidth, h: img.naturalHeight })
    renderedHeight.set(sizeKey(url, spec.width), img.getBoundingClientRect().height / zoomAt(view.contentDOM))
    view.requestMeasure()
  })
  img.addEventListener('error', broken)
  img.src = url
  s.appendChild(img)
  s.appendChild(resizeGrip(view, img, spec.width))
  return s
}

/** Estimated height (px) of one image before it is measured. */
function estimateImage(spec: ImageSpec): number {
  const url = resolveImageSrc(spec.src)
  if (!url) return 28
  const seen = renderedHeight.get(sizeKey(url, spec.width))
  if (seen) return seen
  const nat = naturalSize.get(url)
  if (nat && nat.w) return (Math.min(spec.width ?? nat.w, 680) * nat.h) / nat.w
  return spec.width ? spec.width * 0.6 : 200
}

/** Bottom-right grip (shown on hover, editable only): drag = live proportional resize, release = write |width. */
function resizeGrip(view: EditorView, img: HTMLImageElement, width: number | null): HTMLElement {
  const h = document.createElement('span')
  h.className = 'cm-md-image-grip'
  h.title = '拖动调整图片大小'
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || view.state.readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const zoom = zoomAt(view.contentDOM)
    const startX = e.clientX
    const startW = img.getBoundingClientRect().width
    const wrap = img.parentElement!
    wrap.classList.add('resizing')
    let w = Math.round(startW / zoom)
    // window-level listeners: synthetic drags don't honour pointer capture
    const move = (ev: PointerEvent): void => {
      w = clampWidth((startW + ev.clientX - startX) / zoom, view)
      img.style.width = cssWidth(w)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      wrap.classList.remove('resizing')
      const t = imageTarget(view, wrap)
      if (!setImageWidth(view, t.pos, w, t.side)) img.style.width = width ? cssWidth(width) : ''
      view.requestMeasure()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
  return h
}

/** An image inside a line of text (the line keeps its own text around it). */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null = null,
    /** shown after the revealed source (cursor inside) rather than replacing it */
    readonly after = false
  ) {
    super()
  }
  eq(o: ImageWidget): boolean {
    return o.src === this.src && o.alt === this.alt && o.width === this.width && o.after === this.after
  }
  // right-click reaches the editor's handler (size presets); everything else stays the widget's own
  ignoreEvent(e: Event): boolean {
    return e.type !== 'contextmenu'
  }
  toDOM(view: EditorView): HTMLElement {
    const s = buildImage(view, { src: this.src, alt: this.alt, width: this.width }, 'span')
    s.dataset.imageSide = this.after ? '-1' : '1'
    return s
  }
}

/**
 * A line holding nothing but image(s), as a block: it replaces the whole source
 * line (or, with the caret on the line, sits under the revealed source). No
 * line box of its own; CSS supplies body line-leading around and between images.
 */
export class ImageLineWidget extends WidgetType {
  constructor(
    readonly images: ImageSpec[],
    readonly after = false
  ) {
    super()
  }
  eq(o: ImageLineWidget): boolean {
    return (
      o.after === this.after &&
      o.images.length === this.images.length &&
      o.images.every((a, i) => a.src === this.images[i].src && a.alt === this.images[i].alt && a.width === this.images[i].width)
    )
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'contextmenu'
  }
  get estimatedHeight(): number {
    const gap = 12.8 // body line-leading: 16px * (1.8 - 1), including outer half-gaps
    return this.images.reduce((sum, im) => sum + estimateImage(im), 0) + gap * this.images.length
  }
  toDOM(view: EditorView): HTMLElement {
    const d = document.createElement('div')
    d.className = 'cm-md-image-line'
    this.images.forEach((spec, i) => {
      const s = buildImage(view, spec, 'div')
      s.dataset.imageIndex = String(i)
      d.appendChild(s)
    })
    return d
  }
}
