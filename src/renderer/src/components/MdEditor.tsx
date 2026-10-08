import { useCallback, useEffect, useRef, useState } from 'react'
import { ChangeSet, Compartment, EditorState, StateEffect, Text, type Extension } from '@codemirror/state'
import { EditorView, dropCursor, keymap, placeholder, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import type { Annotation, AnnoAnchor, Note } from '../../../preload'
import type { AnnoRenderProps } from '../lib/annoRender'
import { useDocChrome } from '../lib/docChrome'
import type { SaveStatus } from '../lib/useAutosave'
import { takeFresh } from '../lib/annoMotion'
import { markdownSupport, markTag, mathTag } from '../lib/md/syntax'
import { livePreview, setRenderMode, type RenderMode } from '../lib/md/livePreview'
import { annotations, annoRanges, setAnnos, type EditorAnno } from '../lib/md/annos'
import { markdownEditing } from '../lib/md/commands'
import { mdAnchor, migrateLegacy, plainQuote, relocate, visibleText } from '../lib/md/anchors'
import { createSearchPanel, openReplacePanel } from './MdSearchPanel'
import { FreehandLayer } from './FreehandLayer'
import { TreeContextMenu, type MenuItem } from './TreeContextMenu'
import { clampWidth, pastedImageWidth, readingWidth, setImageWidth } from '../lib/md/imageSize'
import { imageTarget } from '../lib/md/widgets'

const AUTOSAVE_MS = 1200

// ---- lossless save -------------------------------------------------------------
// The editor works on a normalised copy of the file (lines split on \r\n / \r /
// \n, no BOM). Saving never re-serialises that copy: the edits made since the
// last save (a composed ChangeSet) are replayed onto the original text, so
// every byte the user did not touch — BOM, each line's own line ending — is
// written back exactly as it was.
interface Base {
  text: string // the file text as last read / written
  doc: Text // its normalised form, as the editor saw it
  lineStarts: number[] // original offset of each normalised line
  sep: string // line ending for new lines: the file's dominant one
}

function analyze(text: string): Base {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const lineStarts = [bom]
  let crlf = 0
  let lf = 0
  for (let i = bom; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      }
      lineStarts.push(i + 1)
    } else if (c === 10) {
      lf++
      lineStarts.push(i + 1)
    }
  }
  const doc = Text.of(text.slice(bom).split(/\r\n|\r|\n/))
  return { text, doc, lineStarts, sep: crlf > lf ? '\r\n' : '\n' }
}

function serialize(base: Base, changes: ChangeSet): string {
  const toOrig = (pos: number): number => {
    const line = base.doc.lineAt(pos)
    return base.lineStarts[line.number - 1] + (pos - line.from)
  }
  let out = ''
  let last = 0
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const a = toOrig(fromA)
    out += base.text.slice(last, a) + inserted.toString().split('\n').join(base.sep)
    last = toOrig(toA)
  })
  return out + base.text.slice(last)
}

// ---- per-note editor state (keeps undo history across note switches) -------------
interface Session {
  id: string
  base: Base
  pending: ChangeSet
  dirty: boolean
  state: EditorState | null
  /** latest anchor per annotation id, as last persisted (re-location starts from it) */
  anchors: Map<string, AnnoAnchor>
}
const sessions = new Map<string, Session>()

const sourceStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-3)' },
  { tag: tags.processingInstruction, color: 'var(--text-3)' },
  { tag: tags.quote, color: 'var(--text-2)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: markTag, backgroundColor: 'var(--accent-softer)' },
  { tag: mathTag, fontFamily: 'var(--font-mono)', fontSize: '0.88em' }
])

const theme = EditorView.theme({
  '&': { color: 'inherit', backgroundColor: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '1.5px' },
  // native selection + caret (no drawSelection): the browser paints them on the
  // text itself, so they stay aligned under zoom, list indents and hidden syntax
  '.cm-content ::selection, .cm-content::selection': { backgroundColor: 'var(--selection)' },
  '.cm-panels': { backgroundColor: 'transparent', color: 'inherit' },
  '.cm-panels.cm-panels-top': { borderBottom: 'none' },
  '.cm-placeholder': { color: 'var(--text-3)' }
})

interface Props {
  note: Note
  mode: RenderMode
  readOnly: boolean
  scale: number
  anno: AnnoRenderProps
  onStatus: (s: SaveStatus) => void
  onSaved: () => void
  onToggleSource: () => void
}

/**
 * The markdown note editor (CodeMirror 6, live preview). The .md text is the
 * only truth; rendering is decoration. Loads/saves the note itself (debounced
 * autosave + flush on switch), keeps text annotations anchored to the source
 * and hosts the freehand layer.
 */
export function MdEditor({ note, mode, readOnly, scale, anno, onStatus, onSaved, onToggleSource }: Props): JSX.Element {
  const chrome = useDocChrome()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orphanKeyRef = useRef('')
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef({ anno, onStatus, onSaved, onToggleSource, mode, readOnly })
  cb.current = { anno, onStatus, onSaved, onToggleSource, mode, readOnly }
  const roComp = useRef(new Compartment())
  const hlComp = useRef(new Compartment())
  const hasDrawings = anno.annos.some((a) => a.type === 'drawing')
  const [imgMenu, setImgMenu] = useState<{ x: number; y: number; pos: number; side: 1 | -1 } | null>(null)
  const closeImgMenu = useCallback(() => setImgMenu(null), [])

  // ---- saving ----
  function persistAnchors(s: Session, state: EditorState): void {
    const list = cb.current.anno.annos
    const byId = new Map(list.map((a) => [a.id, a]))
    const items: { id: string; anchor: Annotation['anchor']; quote: string }[] = []
    for (const [id, r] of annoRanges(state)) {
      const a = byId.get(id)
      if (!a) continue
      const text = state.sliceDoc(r.from, r.to)
      const prev = s.anchors.get(id)
      const pl = prev?.locator
      if (prev && pl?.type === 'md' && pl.start === r.from && pl.end === r.to && prev.text === text) continue
      const anchor = mdAnchor(state, r.from, r.to)
      const quote = prev && prev.text === text ? a.quote : plainQuote(state, r.from, r.to) || a.quote
      items.push({ id, anchor, quote })
      s.anchors.set(id, anchor)
    }
    if (items.length) window.api.annotations.updateAnchors(items)
  }

  /** Write pending edits now (synchronously snapshots, then saves). */
  function flush(): Promise<void> {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const s = sessionRef.current
    const view = viewRef.current
    if (!s || !view || !s.dirty) return Promise.resolve()
    const state = view.state
    const content = serialize(s.base, s.pending)
    s.base = { ...analyze(content), doc: state.doc }
    s.pending = ChangeSet.empty(state.doc.length)
    s.dirty = false
    const id = s.id
    persistAnchors(s, state)
    return window.api.notes.saveContent(id, content).then(() => {
      if (sessionRef.current?.id === id && !sessionRef.current.dirty) cb.current.onStatus('saved')
      cb.current.onSaved()
    })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  // ---- annotations → decorations ----
  function syncAnnos(activeOnly = false): void {
    const view = viewRef.current
    const s = sessionRef.current
    if (!view || !s) return
    const state = view.state
    const current = annoRanges(state)
    const list: EditorAnno[] = []
    const orphans: string[] = []
    const migrated: { id: string; anchor: Annotation['anchor']; quote: string }[] = []
    const cache = {}
    let src: string | null = null
    const { annos, activeAnnoId } = cb.current.anno
    let anyFresh = false
    for (const a of annos) {
      if (a.type === 'drawing' || a.type === 'rect') continue
      const loc = a.anchor.locator
      let range = current.get(a.id) ?? null
      if (!range && !activeOnly) {
        const known = s.anchors.get(a.id) ?? a.anchor
        const k = known.locator
        if (k.type === 'md') {
          // exact position first, else re-found by quote + context; written back when it moved
          src ??= state.doc.toString()
          range = relocate(src, known)
          if (range && (k.start !== range.from || k.end !== range.to)) {
            const anchor = mdAnchor(state, range.from, range.to)
            migrated.push({ id: a.id, anchor, quote: a.quote })
            s.anchors.set(a.id, anchor)
          } else if (range) s.anchors.set(a.id, known)
        } else if (loc.type === 'text') {
          const m = migrateLegacy(state, a, cache)
          if (m) {
            range = { from: (m.anchor.locator as { start: number }).start, to: (m.anchor.locator as { end: number }).end }
            migrated.push({ id: a.id, anchor: m.anchor, quote: m.quote })
            s.anchors.set(a.id, m.anchor)
          }
        }
      }
      if (!range) {
        orphans.push(a.id)
        continue
      }
      const fresh = takeFresh(a.id)
      anyFresh ||= fresh
      list.push({ id: a.id, type: a.type, color: a.color, note: a.note_text, from: range.from, to: range.to, fresh })
    }
    view.dispatch({ effects: setAnnos.of({ annos: list, activeId: activeAnnoId }) })
    if (migrated.length) window.api.annotations.updateAnchors(migrated)
    reportOrphans(orphans)
    // the sweep plays once; drop the class so a line re-render never replays it
    if (anyFresh) setTimeout(() => syncAnnos(true), 700)
  }
  const syncRef = useRef(syncAnnos)
  syncRef.current = syncAnnos

  function reportOrphans(ids: string[]): void {
    const key = [...ids].sort().join(',')
    if (key === orphanKeyRef.current) return
    orphanKeyRef.current = key
    cb.current.anno.onOrphans(ids)
  }

  // ---- create the view once ----
  useEffect(() => {
    const onUpdate = (u: ViewUpdate): void => {
      const s = sessionRef.current
      if (!s || !u.docChanged) return
      s.pending = s.pending.compose(u.changes)
      s.dirty = true
      cb.current.onStatus('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => flushRef.current(), AUTOSAVE_MS)
      // an annotation whose text was deleted drops out → 失配; one whose text
      // comes back (undo, retyped) is found again by its quote + context
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => syncRef.current(), 250)
    }
    const pasteImages = async (view: EditorView, files: File[], at: number | null): Promise<void> => {
      const s = sessionRef.current
      if (!s) return
      let pos = at ?? view.state.selection.main.head
      for (const f of files) {
        const d = new Date()
        const p2 = (n: number): string => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
        const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `粘贴图片 ${stamp}.${ext}`
        // a pasted screenshot keeps the size it had on screen (pixels ÷ devicePixelRatio)
        const width = at == null ? await pastedImageWidth(f, view) : null
        const item = await window.api.files.addImage(s.id, name, new Uint8Array(await f.arrayBuffer()))
        if (sessionRef.current?.id !== s.id || !viewRef.current) return
        const alt = item.title.replace(/[[\]|]/g, '')
        const insert = `![${alt}${width ? `|${width}` : ''}](xnote-file://${item.id})`
        pos = Math.min(pos, viewRef.current.state.doc.length)
        viewRef.current.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input.paste' })
        pos += insert.length
      }
      cb.current.onSaved()
    }
    const imageFiles = (list: FileList | undefined | null): File[] => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))

    const extensions: Extension = [
      history(),
      dropCursor(),
      EditorView.lineWrapping,
      markdownSupport(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      livePreview(),
      annotations((id) => cb.current.anno.onAnnoClick(id)),
      hlComp.current.of([]),
      search({ top: true, createPanel: createSearchPanel }),
      markdownEditing({
        toggleSource: () => cb.current.onToggleSource(),
        saveNow: () => void flushRef.current(),
        openReplace: openReplacePanel
      }),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      roComp.current.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      EditorView.updateListener.of(onUpdate),
      EditorView.domEventHandlers({
        paste(e, view) {
          const files = imageFiles(e.clipboardData?.files)
          if (!files.length || view.state.readOnly) return false
          e.preventDefault()
          pasteImages(view, files, null)
          return true
        },
        drop(e, view) {
          const files = imageFiles(e.dataTransfer?.files)
          if (!files.length || view.state.readOnly) return false
          e.preventDefault()
          pasteImages(view, files, view.posAtCoords({ x: e.clientX, y: e.clientY }))
          return true
        },
        contextmenu(e, view) {
          const el = (e.target as HTMLElement).closest('.cm-md-image') as HTMLElement | null
          if (!el || el.classList.contains('broken') || view.state.readOnly) return false
          e.preventDefault()
          const menu = { x: e.clientX, y: e.clientY, ...imageTarget(view, el) }
          // open after this event: the menu closes on any window contextmenu, this one included
          setTimeout(() => setImgMenu(menu), 0)
          return true
        }
      }),
      EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': '笔记正文' }),
      placeholder('开始写点什么…'),
      theme
    ]
    const view = new EditorView({ parent: hostRef.current!, state: EditorState.create({ doc: '', extensions }) })
    viewRef.current = view
    ;(view as unknown as { __extensions: Extension }).__extensions = extensions
    return () => {
      flushRef.current()
      const s = sessionRef.current
      if (s) s.state = view.state
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // ---- load the note (flush the previous one first) ----
  useEffect(() => {
    let cancelled = false
    const view = viewRef.current!
    const extensions = (view as unknown as { __extensions: Extension }).__extensions
    cb.current.onStatus('idle')
    window.api.notes.getContent(note.id).then((r) => {
      if (cancelled) return
      const text = r?.content ?? ''
      const cached = sessions.get(note.id)
      let s: Session
      if (cached && cached.state && cached.base.text === text && !cached.dirty) {
        s = cached
        // this component instance is new (documents are keyed by note): swap in
        // its extensions — compartments, listeners — while module-level fields
        // such as the undo history carry over
        view.setState(cached.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state)
      } else {
        const base = analyze(text)
        s = { id: note.id, base, pending: ChangeSet.empty(base.doc.length), dirty: false, state: null, anchors: new Map() }
        view.setState(EditorState.create({ doc: base.doc, extensions }))
      }
      sessions.set(note.id, s)
      sessionRef.current = s
      orphanKeyRef.current = ''
      applyMode()
      syncRef.current()
      if (cb.current.anno.annos.some((a) => a.type === 'drawing')) measureAll()
    })
    return () => {
      cancelled = true
      flushRef.current()
      const s = sessionRef.current
      if (s && viewRef.current) s.state = viewRef.current.state
      sessionRef.current = null
    }
  }, [note.id])

  // ---- mode / read-only ----
  function applyMode(): void {
    const view = viewRef.current
    if (!view) return
    const { mode, readOnly } = cb.current
    if (readOnly && view.hasFocus) view.contentDOM.blur()
    view.dispatch({
      effects: [
        setRenderMode.of(mode),
        roComp.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        hlComp.current.reconfigure(mode === 'source' ? syntaxHighlighting(sourceStyle) : [])
      ]
    })
  }
  useEffect(applyMode, [mode, readOnly])

  // ---- annotations prop → decorations ----
  useEffect(() => {
    if (sessionRef.current) syncRef.current()
  }, [anno.annos])
  useEffect(() => {
    const view = viewRef.current
    if (!view || !sessionRef.current) return
    syncRef.current(true)
    const id = anno.activeAnnoId
    const r = id ? annoRanges(view.state).get(id) : null
    if (r) view.dispatch({ effects: EditorView.scrollIntoView(r.from, { y: 'center' }) })
  }, [anno.activeAnnoId])

  // ---- zoom: re-measure line heights; strokes need exact heights ----
  function measureAll(): void {
    // CodeMirror renders the whole document while printing; borrowing that
    // once gives every line a measured (not estimated) height, which keeps
    // freehand strokes — stored relative to the document height — in place.
    requestAnimationFrame(() => window.dispatchEvent(new Event('beforeprint')))
  }
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    ;(view as unknown as { viewState: { mustMeasureContent: boolean | string } }).viewState.mustMeasureContent = 'refresh'
    view.requestMeasure()
    if (hasDrawings) measureAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])
  useEffect(() => {
    if (anno.pen.active) measureAll()
  }, [anno.pen.active])
  // window resize / sidebar or panel toggles change the editor width: re-measure
  // so click hit-testing and caret positions stay exact
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const remeasure = (): void => viewRef.current?.requestMeasure()
    const ro = new ResizeObserver(remeasure)
    ro.observe(host)
    window.addEventListener('resize', remeasure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', remeasure)
    }
  }, [])

  // ---- 标注 mode: selection → source anchor ----
  useEffect(() => {
    if (!chrome) return
    chrome.setAnchorSource(() => {
      const view = viewRef.current
      const sel = window.getSelection()
      if (!view || !sel || sel.rangeCount === 0 || !sel.anchorNode || !view.contentDOM.contains(sel.anchorNode)) return undefined
      if (sel.isCollapsed) return null
      const range = sel.getRangeAt(0)
      let from = view.posAtDOM(range.startContainer, range.startOffset)
      let to = view.posAtDOM(range.endContainer, range.endOffset)
      if (to < from) [from, to] = [to, from]
      const state = view.state
      // snap to the first / last rendered character: a drag that starts on a
      // bullet or ends past a closing ** must not take hidden syntax along
      const vis = visibleText(state, from, to, false)
      const trimmed = vis.text.trimEnd()
      const i0 = trimmed.search(/\S/)
      if (i0 < 0) return null
      from = vis.from[i0]
      to = vis.to[trimmed.length - 1]
      const quote = plainQuote(state, from, to)
      if (!quote) return null
      const b = range.getBoundingClientRect()
      return { anchor: mdAnchor(state, from, to), quote, rect: { x: b.left, y: b.top, width: b.width, height: b.height } }
    })
    return () => chrome.setAnchorSource(null)
  }, [chrome])

  // ---- image right-click: preset widths ----
  function sizeImage(width: number | 'pct' | null, pct = 1): void {
    const view = viewRef.current
    const m = imgMenu
    if (!view || !m) return
    setImageWidth(view, m.pos, width === 'pct' ? clampWidth(readingWidth(view) * pct, view) : width, m.side)
  }
  const imgMenuItems: MenuItem[] = [
    ...[0.25, 0.5, 0.75, 1].map((p) => ({ label: `${p * 100}%`, onClick: () => sizeImage('pct', p) })),
    { sep: true },
    { label: '原始大小', onClick: () => sizeImage(null) }
  ]

  return (
    <div className={`md-editor html-anno-wrap mode-${mode}${readOnly ? ' readonly' : ''}`}>
      <div ref={hostRef} className="md-editor-host doc-view preview doc-substrate" />
      <FreehandLayer page={0} annos={anno.annos} activeId={anno.activeAnnoId} pen={anno.pen} />
      {imgMenu && <TreeContextMenu x={imgMenu.x} y={imgMenu.y} items={imgMenuItems} onClose={closeImgMenu} />}
    </div>
  )
}

