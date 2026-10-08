import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { FileQuestion } from 'lucide-react'
import type { Note, Annotation, AnnoAnchor, NewAnnotation } from '../../../preload'
import { loadZoom, saveZoom, type ZoomClass, type ZoomState } from '../lib/zoom'
import { computeAnchor, textareaAnchor } from '../lib/selection'
import { saveTool, loadColor, saveColor, type Tool } from '../lib/annoTools'
import { pushRecentColor } from '../lib/annoColors'
import { markFresh, fadeOutAnno } from '../lib/annoMotion'
import type { AnnoRenderProps, PenTool, EraserMode, NewStroke } from '../lib/annoRender'
import { DocChromeContext, type DocChrome, type DocMode, type AnchorSource } from '../lib/docChrome'
import { DocShell, AddToReviewButton, ReplaceFileButton } from './DocShell'
import { FileTitleInput } from './FileTitleInput'
import { AnnotationToolbar } from './AnnotationToolbar'
import { AnnotationSidebar } from './AnnotationSidebar'
import { PenToolbar, PEN_SIZES } from './PenToolbar'
import { Splitter } from './Splitter'
import { usePresence, ICON } from './ui'
import { MarkdownRenderer } from './renderers/MarkdownRenderer'
import { PdfRenderer } from './renderers/PdfRenderer'
import { DocxRenderer } from './renderers/DocxRenderer'
import { ImageRenderer } from './renderers/ImageRenderer'
import { SheetRenderer } from './renderers/SheetRenderer'
import { TextRenderer } from './renderers/TextRenderer'

type FileKind = 'pdf' | 'image' | 'docx' | 'sheet' | 'text' | 'fallback'

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'xml', 'yml', 'yaml', 'ini', 'js', 'ts',
  'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php',
  'sh', 'html', 'css'
])
const extOf = (n: Note): string => (n.original_name?.split('.').pop() ?? '').toLowerCase()

function fileKind(note: Note): FileKind {
  const mime = note.mime_type ?? ''
  const ext = extOf(note)
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx'
  if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('spreadsheet') || mime.includes('ms-excel') || mime === 'text/csv')
    return 'sheet'
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTS.has(ext)) return 'text'
  return 'fallback'
}
function zoomClass(note: Note): ZoomClass {
  if (note.kind === 'markdown') return 'markdown'
  const k = fileKind(note)
  return k === 'pdf' ? 'pdf' : k === 'image' ? 'image' : k === 'docx' ? 'doc' : k === 'sheet' ? 'sheet' : 'text'
}

/** Fallback for types with no in-app renderer. */
function FallbackRenderer({ note, onSaved, onReplace, onAddToReview }: {
  note: Note; onSaved: () => void; onReplace: (id: string) => void; onAddToReview: (id: string) => void
}): JSX.Element {
  const controls = (
    <>
      <ReplaceFileButton onClick={() => onReplace(note.id)} />
      {note.state === 'library' && <AddToReviewButton onClick={() => onAddToReview(note.id)} />}
    </>
  )
  return (
    <DocShell title={<FileTitleInput note={note} onSaved={onSaved} />} controls={controls}>
      <div className="fallback-view">
        <FileQuestion size={ICON.xl} strokeWidth={ICON.strokeLight} className="fallback-icon" />
        <div className="fallback-name">{note.original_name}</div>
        <div className="fallback-sub">此类型暂不支持在软件内预览</div>
        <button className="btn btn-secondary" onClick={() => window.api.files.openInSystem(note.id)}>用系统程序打开</button>
      </div>
    </DocShell>
  )
}

// ---- persisted pen preferences ----------------------------------------------
const store = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : def
    } catch {
      return def
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }
}
const SIDEBAR_W = { def: 300, min: 240, max: 560, key: 'xnote.annoSidebarW' }

/** One reversible edit for undo/redo. */
type Action =
  | { kind: 'create'; anno: Annotation }
  | { kind: 'delete'; anno: Annotation }
  | { kind: 'replace'; removed: Annotation[]; added: Annotation[] }

const strokePayload = (s: NewStroke): NewAnnotation => ({
  type: 'drawing',
  color: s.color,
  anchor: { text: '', prefix: '', suffix: '', locator: { type: 'drawing', page: s.page, points: s.points, size: s.size, tool: s.tool } },
  quote: ''
})

interface Props {
  note: Note
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  onOpenTimeline: () => void
  revealAnnoId?: string | null
  /** Start markdown/text in the reading view (used by review). */
  preferRead?: boolean
}

export function DocumentView({ note, onSaved, onAddToReview, onReplace, onOpenTimeline, revealAnnoId, preferRead = false }: Props): JSX.Element {
  const cls = zoomClass(note)
  const kind: FileKind | 'markdown' = note.kind === 'markdown' ? 'markdown' : fileKind(note)
  const [zoom, setZoom] = useState<ZoomState>(() => loadZoom(cls))
  useEffect(() => setZoom(loadZoom(cls)), [cls, note.id])
  const onZoom = useCallback(
    (z: ZoomState): void => {
      setZoom(z)
      saveZoom(cls, z)
    },
    [cls]
  )

  // ---- mode + tools ----
  const [mode, setModeState] = useState<DocMode>('read')
  const [rectOn, setRectOn] = useState(false)
  const [penTool, setPenTool] = useState<PenTool>(() => store.get<PenTool>('xnote.pen.tool', 'pen'))
  const [eraserMode, setEraserMode] = useState<EraserMode>(() => store.get<EraserMode>('xnote.pen.eraserMode', 'stroke'))
  const [sizeIdx, setSizeIdx] = useState<Record<PenTool, number>>(() => store.get('xnote.pen.sizes', { pen: 1, marker: 1, eraser: 1 }))
  const [color, setColor] = useState<string>(loadColor)

  // ---- annotation state ----
  const [annos, setAnnos] = useState<Annotation[]>([])
  const [orphanedIds, setOrphanedIds] = useState<Set<string>>(new Set())
  const [activeAnnoId, setActiveAnnoId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarW, setSidebarW] = useState(() => store.get(SIDEBAR_W.key, SIDEBAR_W.def))
  const sidebar = usePresence(sidebarOpen)
  const [popup, setPopup] = useState<{ rect: { x: number; y: number; width: number; height: number }; anchor: AnnoAnchor; quote?: string } | null>(null)
  const anchorSourceRef = useRef<AnchorSource | null>(null)
  const setAnchorSource = useCallback((fn: AnchorSource | null) => {
    anchorSourceRef.current = fn
  }, [])

  const frameRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const revealedRef = useRef<string | null>(null)

  const reloadAnnos = useCallback(async () => {
    setAnnos(await window.api.annotations.list(note.id))
  }, [note.id])

  // ---- undo / redo ----
  const undoStack = useRef<Action[]>([])
  const redoStack = useRef<Action[]>([])
  const [, bump] = useState(0)
  const push = (a: Action): void => {
    undoStack.current.push(a)
    redoStack.current = []
    bump((n) => n + 1)
  }
  const apply = async (a: Action, inverse: boolean): Promise<void> => {
    const api = window.api.annotations
    if (a.kind === 'create') {
      if (inverse) await api.delete(a.anno.id)
      else await api.restore(a.anno)
    } else if (a.kind === 'delete') {
      if (inverse) await api.restore(a.anno)
      else await api.delete(a.anno.id)
    } else {
      const gone = inverse ? a.added : a.removed
      const back = inverse ? a.removed : a.added
      for (const x of gone) await api.delete(x.id)
      for (const x of back) await api.restore(x)
    }
  }
  const undo = useCallback(async () => {
    const a = undoStack.current.pop()
    if (!a) return
    await apply(a, true)
    redoStack.current.push(a)
    bump((n) => n + 1)
    await reloadAnnos()
  }, [reloadAnnos])
  const redo = useCallback(async () => {
    const a = redoStack.current.pop()
    if (!a) return
    await apply(a, false)
    undoStack.current.push(a)
    bump((n) => n + 1)
    await reloadAnnos()
  }, [reloadAnnos])

  useEffect(() => {
    setActiveAnnoId(null)
    setPopup(null)
    setModeState('read')
    setRectOn(false)
    setOrphanedIds(new Set())
    undoStack.current = []
    redoStack.current = []
    revealedRef.current = null
    reloadAnnos()
  }, [note.id, reloadAnnos])

  const setMode = useCallback((m: DocMode) => {
    setModeState(m)
    setPopup(null)
    if (m !== 'annotate') setRectOn(false)
    if (m !== 'annotate') window.getSelection()?.removeAllRanges()
  }, [])
  const chooseTool = (t: PenTool): void => {
    setPenTool(t)
    store.set('xnote.pen.tool', t)
  }
  const chooseEraserMode = (m: EraserMode): void => {
    setEraserMode(m)
    store.set('xnote.pen.eraserMode', m)
  }
  const chooseSize = (i: number): void => {
    setSizeIdx((prev) => {
      const next = { ...prev, [penTool]: i }
      store.set('xnote.pen.sizes', next)
      return next
    })
  }
  function pickColor(c: string): void {
    setColor(c)
    saveColor(c) // remembered as the current color; "recent" is recorded only on use
  }

  const locate = useCallback((id: string) => {
    setActiveAnnoId(id)
    requestAnimationFrame(() => {
      const el = frameRef.current?.querySelector(`[data-anno-id="${id}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    if (revealAnnoId && annos.some((a) => a.id === revealAnnoId) && revealedRef.current !== revealAnnoId) {
      revealedRef.current = revealAnnoId
      setSidebarOpen(true)
      locate(revealAnnoId)
    }
  }, [revealAnnoId, annos, locate])

  const canRect = kind === 'pdf' || kind === 'image'
  const canDraw = ['pdf', 'image', 'docx', 'text'].includes(kind) || note.kind === 'markdown'

  // ---- keyboard: P / H / E / Esc, Ctrl+Z / Ctrl+Shift+Z ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      const inDoc = !t || t === document.body || !!frameRef.current?.contains(t)
      if (typing || !inDoc) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (k === 'escape') {
        // Esc first closes an open popover (colour picker, eraser menu…); only a
        // second Esc leaves the current mode
        if (document.querySelector('.popover')) return
        setMode('read')
        return
      }
      if (!canDraw) return
      if (k === 'p') {
        chooseTool('pen')
        setMode('pen')
      } else if (k === 'h') {
        chooseTool('marker')
        setMode('pen')
      } else if (k === 'e') {
        chooseTool('eraser')
        setMode('pen')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, setMode, canDraw])

  // ---- selection → annotate popup (标注 mode only) ----
  function handleMouseUp(e: ReactMouseEvent): void {
    if (mode !== 'annotate' || rectOn) return
    const t = e.target as HTMLElement
    if (t.closest('.popover') || t.closest('.anno-sidebar') || t.closest('.editor-header') || t.closest('.below-header')) return
    const px = e.clientX
    const py = e.clientY
    setTimeout(() => {
      const r = currentAnchor(px, py)
      setPopup(r)
    }, 0)
  }
  function currentAnchor(px: number, py: number): typeof popup {
    const main = mainRef.current
    // the markdown editor maps its selection to source positions itself
    const custom = anchorSourceRef.current?.()
    if (custom !== undefined) return custom
    const active = document.activeElement
    if (active instanceof HTMLTextAreaElement && main?.contains(active)) {
      const a = textareaAnchor(active)
      return a ? { anchor: a, rect: { x: px, y: py - 10, width: 1, height: 10 } } : null
    }
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const node = sel.anchorNode
    if (!main || !node || !main.contains(node)) return null
    const el = node instanceof HTMLElement ? node : node.parentElement
    const anchor = el?.closest('.textLayer') ? computeAnchor('pdf') : el?.closest('.doc-substrate') ? computeAnchor('text') : null
    if (!anchor) return null
    const b = sel.getRangeAt(0).getBoundingClientRect()
    return { anchor, rect: { x: b.left, y: b.top, width: b.width, height: b.height } }
  }

  // ---- creation (each pushes an undoable action) ----
  async function create(type: Tool): Promise<void> {
    if (!popup) return
    const a = await window.api.annotations.add(note.id, {
      type,
      color,
      anchor: popup.anchor,
      quote: popup.quote ?? popup.anchor.text,
      note_text: type === 'comment' ? '' : null
    })
    push({ kind: 'create', anno: a })
    markFresh(a.id) // the new highlight sweeps in; existing ones never animate
    pushRecentColor(color)
    saveTool(type)
    window.getSelection()?.removeAllRanges()
    setPopup(null)
    await reloadAnnos()
    if (type === 'comment') setSidebarOpen(true)
  }
  const createRect = useCallback(
    async (page: number, x: number, y: number, w: number, h: number) => {
      const a = await window.api.annotations.add(note.id, {
        type: 'rect',
        color,
        anchor: { text: '', prefix: '', suffix: '', locator: { type: 'rect', page, x, y, w, h } },
        quote: ''
      })
      push({ kind: 'create', anno: a })
      pushRecentColor(color)
      setRectOn(false)
      await reloadAnnos()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, color, reloadAnnos]
  )
  const createStroke = useCallback(
    async (s: NewStroke) => {
      const a = await window.api.annotations.add(note.id, strokePayload(s))
      push({ kind: 'create', anno: a })
      pushRecentColor(s.color)
      await reloadAnnos()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, reloadAnnos]
  )
  const commitErase = useCallback(
    async (removed: Annotation[], added: NewStroke[]) => {
      for (const r of removed) await window.api.annotations.delete(r.id)
      const created: Annotation[] = []
      for (const s of added) created.push(await window.api.annotations.add(note.id, strokePayload(s)))
      push({ kind: 'replace', removed, added: created })
      await reloadAnnos()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, reloadAnnos]
  )
  const changeColor = async (id: string, c: string): Promise<void> => {
    await window.api.annotations.update(id, { color: c })
    pushRecentColor(c)
    reloadAnnos()
  }
  const editNote = async (id: string, text: string): Promise<void> => {
    await window.api.annotations.update(id, { note_text: text })
    reloadAnnos()
  }
  const deleteAnno = async (id: string): Promise<void> => {
    const a = annos.find((x) => x.id === id)
    await fadeOutAnno(frameRef.current, id)
    await window.api.annotations.delete(id)
    if (a) push({ kind: 'delete', anno: a })
    reloadAnnos()
  }

  const penSizePx = PEN_SIZES[penTool][sizeIdx[penTool] ?? 1]
  const annoProps: AnnoRenderProps = {
    annos,
    activeAnnoId,
    rectMode: mode === 'annotate' && rectOn,
    pen: {
      active: mode === 'pen',
      tool: penTool,
      sizePx: penSizePx,
      color,
      eraserMode,
      onCreate: createStroke,
      onEraseCommit: commitErase
    },
    onAnnoClick: locate,
    onOrphans: (ids) => setOrphanedIds(new Set(ids)),
    onCreateRect: createRect
  }
  const common = { note, zoom, onZoom, onSaved, onAddToReview, onReplace, anno: annoProps }

  let renderer: JSX.Element
  if (note.kind === 'markdown') renderer = <MarkdownRenderer note={note} zoom={zoom} onZoom={onZoom} onSaved={onSaved} anno={annoProps} />
  else if (kind === 'pdf') renderer = <PdfRenderer {...common} />
  else if (kind === 'image') renderer = <ImageRenderer {...common} />
  else if (kind === 'docx') renderer = <DocxRenderer {...common} />
  else if (kind === 'sheet') renderer = <SheetRenderer {...common} />
  else if (kind === 'text') renderer = <TextRenderer note={note} zoom={zoom} onZoom={onZoom} onSaved={onSaved} onAddToReview={onAddToReview} anno={annoProps} />
  else renderer = <FallbackRenderer note={note} onSaved={onSaved} onReplace={onReplace} onAddToReview={onAddToReview} />

  const chrome: DocChrome = useMemo(
    () => ({
      mode,
      setMode,
      canDraw,
      canRect,
      rectMode: rectOn,
      toggleRect: () => setRectOn((v) => !v),
      zoom,
      onZoom,
      belowOpen: mode === 'pen',
      below: (
        <PenToolbar
          tool={penTool}
          onTool={chooseTool}
          eraserMode={eraserMode}
          onEraserMode={chooseEraserMode}
          sizeIdx={sizeIdx[penTool] ?? 1}
          onSizeIdx={chooseSize}
          color={color}
          onColor={pickColor}
          canUndo={undoStack.current.length > 0}
          canRedo={redoStack.current.length > 0}
          onUndo={undo}
          onRedo={redo}
        />
      ),
      annoCount: annos.length,
      sidebarOpen,
      toggleSidebar: () => setSidebarOpen((v) => !v),
      preferRead,
      setAnchorSource
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, setMode, canDraw, canRect, rectOn, zoom, onZoom, penTool, eraserMode, sizeIdx, color, undo, redo, annos.length, sidebarOpen, preferRead, undoStack.current.length, redoStack.current.length]
  )

  const modeClass = mode === 'pen' ? ` pen-mode tool-${penTool}` : mode === 'annotate' ? ` annotate-mode${rectOn ? ' rect-mode' : ''}` : ' read-mode'

  return (
    <DocChromeContext.Provider value={chrome}>
      <div className="doc-frame" ref={frameRef} onMouseUp={handleMouseUp}>
        <div className={`doc-main${modeClass}`} ref={mainRef}>
          {renderer}
        </div>

        {sidebar.mounted && (
          <>
            <Splitter
              onDrag={(dx) =>
                setSidebarW((w) => {
                  const next = Math.max(SIDEBAR_W.min, Math.min(SIDEBAR_W.max, w - dx))
                  store.set(SIDEBAR_W.key, next)
                  return next
                })
              }
              onReset={() => {
                setSidebarW(SIDEBAR_W.def)
                store.set(SIDEBAR_W.key, SIDEBAR_W.def)
              }}
            />
            <AnnotationSidebar
              leaving={sidebar.leaving}
              width={sidebarW}
              noteId={note.id}
              annos={annos}
              orphanedIds={orphanedIds}
              activeId={activeAnnoId}
              onLocate={locate}
              onChangeColor={changeColor}
              onEditNote={editNote}
              onDelete={deleteAnno}
              onClose={() => setSidebarOpen(false)}
              onOpenTimeline={onOpenTimeline}
            />
          </>
        )}

        {popup && mode === 'annotate' && (
          <AnnotationToolbar rect={popup.rect} color={color} onCreate={create} onPickColor={pickColor} />
        )}
      </div>
    </DocChromeContext.Provider>
  )
}
