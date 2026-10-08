import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UIEvent, MouseEvent as ReactMouseEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import { Skeleton, EmptyState } from '../ui'
import { FileWarning } from 'lucide-react'
import { paintCharAnnos, hitTest, type AnnoRenderProps, type LocalRect } from '../../lib/annoRender'
import { resolveColor } from '../../lib/annoColors'
import { DocShell, ZoomControls, AddToReviewButton, ReplaceFileButton } from '../DocShell'
import { FileTitleInput } from '../FileTitleInput'
import { FreehandLayer } from '../FreehandLayer'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
const GAP = 16
const BUFFER = 2

function destroyDoc(doc: PDFDocumentProxy | null): void {
  ;(doc as unknown as { destroy?: () => void } | null)?.destroy?.()
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  active,
  cssW,
  cssH,
  anno
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  active: boolean
  cssW: number
  cssH: number
  anno: AnnoRenderProps
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const textDivRef = useRef<HTMLDivElement | null>(null)
  const rectsRef = useRef<Map<string, LocalRect[]>>(new Map())
  const [layerVersion, setLayerVersion] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const annoRef = useRef(anno)
  annoRef.current = anno

  const rectAnnos = anno.annos.filter((a) => a.anchor.locator.type === 'rect' && a.anchor.locator.page === pageNumber)

  const repaint = useCallback(() => {
    const overlay = overlayRef.current
    const textDiv = textDivRef.current
    if (!overlay || !textDiv) return
    const a = annoRef.current
    const res = paintCharAnnos(overlay, textDiv, a.annos.filter((x) => x.anchor.locator.type === 'pdf' && x.anchor.locator.page === pageNumber), a.activeAnnoId)
    rectsRef.current = res.rectsById
  }, [pageNumber])

  // Render canvas (physical px → sharp) + selectable text layer + anno overlay.
  useEffect(() => {
    const layers = layersRef.current
    if (!layers) return
    if (!active) {
      layers.replaceChildren()
      textDivRef.current = null
      overlayRef.current = null
      return
    }
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const overlay = document.createElement('div')
      overlay.className = 'anno-overlay'
      const textDiv = document.createElement('div')
      textDiv.className = 'textLayer'
      textDiv.style.setProperty('--scale-factor', String(scale))
      textDiv.style.width = `${Math.floor(viewport.width)}px`
      textDiv.style.height = `${Math.floor(viewport.height)}px`
      layers.replaceChildren(canvas, overlay, textDiv)
      await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise
      if (cancelled) return
      const textContent = await page.getTextContent()
      if (cancelled) return
      const layer = new TextLayer({ textContentSource: textContent, container: textDiv, viewport })
      await layer.render()
      if (cancelled) return
      overlayRef.current = overlay
      textDivRef.current = textDiv
      repaint()
      setLayerVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [active, scale, pageNumber, pdf, repaint])

  // Repaint char annotations whenever the layer or annotations change.
  useEffect(() => {
    if (!active) return
    repaint()
  }, [layerVersion, anno.annos, anno.activeAnnoId, active, repaint])

  function norm(e: ReactMouseEvent): { x: number; y: number } | null {
    const el = hostRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  function onDown(e: ReactMouseEvent): void {
    if (!anno.rectMode) return
    const p = norm(e)
    if (!p) return
    e.preventDefault()
    startRef.current = p
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  function onMove(e: ReactMouseEvent): void {
    if (!anno.rectMode || !startRef.current) return
    const p = norm(e)
    if (!p) return
    const s = startRef.current
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  function onUp(): void {
    if (!anno.rectMode || !startRef.current || !draft) {
      startRef.current = null
      return
    }
    startRef.current = null
    const d = draft
    setDraft(null)
    if (d.w > 0.01 && d.h > 0.01) anno.onCreateRect(pageNumber, d.x, d.y, d.w, d.h)
  }
  function onClick(e: ReactMouseEvent): void {
    if (anno.rectMode || anno.pen.active) return
    const rectEl = (e.target as HTMLElement).closest('[data-anno-id]') as HTMLElement | null
    if (rectEl?.dataset.annoId) {
      anno.onAnnoClick(rectEl.dataset.annoId)
      return
    }
    const overlay = overlayRef.current
    if (!overlay) return
    const r = overlay.getBoundingClientRect()
    const id = hitTest(rectsRef.current, e.clientX - r.left, e.clientY - r.top)
    if (id) anno.onAnnoClick(id)
  }

  return (
    <div
      className={`pdf-page ${anno.rectMode ? 'rect-mode' : ''}`}
      data-page={pageNumber}
      ref={hostRef}
      style={{ width: cssW, height: cssH }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onClick={onClick}
    >
      <div className="pdf-layers" ref={layersRef} />
      {rectAnnos.map((a) => {
        const loc = a.anchor.locator
        if (loc.type !== 'rect') return null
        const c = resolveColor(a.color)
        return (
          <div
            key={a.id}
            className={`pdf-anno-rect ${anno.activeAnnoId === a.id ? 'active' : ''}`}
            data-anno-id={a.id}
            style={{
              left: `${loc.x * 100}%`,
              top: `${loc.y * 100}%`,
              width: `${loc.w * 100}%`,
              height: `${loc.h * 100}%`,
              ['--c-bg' as string]: c.bg,
              ['--c-line' as string]: c.line
            }}
          />
        )
      })}
      {draft && (
        <div
          className="pdf-anno-rect draft"
          style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
        />
      )}
      {active && (
        <FreehandLayer page={pageNumber} annos={anno.annos} activeId={anno.activeAnnoId} pen={anno.pen} />
      )}
    </div>
  )
}

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  anno: AnnoRenderProps
}

export function PdfRenderer({ note, zoom, onZoom, onSaved, onAddToReview, onReplace, anno }: Props): JSX.Element {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState(false)
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  const [containerW, setContainerW] = useState(800)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [pageInput, setPageInput] = useState('1')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setPdf(null)
    setError(false)
    setBase(null)
    window.api.files.getBytes(note.id).then(async (bytes) => {
      if (!bytes) return !cancelled && setError(true)
      try {
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise
        if (cancelled) {
          destroyDoc(doc)
          return
        }
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
        setPdf(doc)
        setBase({ w: vp.width, h: vp.height })
      } catch {
        if (!cancelled) setError(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [note.id])
  useEffect(() => () => destroyDoc(pdf), [pdf])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerW(el.clientWidth)
      setViewH(el.clientHeight)
    })
    ro.observe(el)
    setContainerW(el.clientWidth)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [pdf])

  // Re-rendering pages is expensive, so while the user is zooming (wheel /
  // pinch) we preview with a CSS scale and re-render at the settled level.
  const [renderPct, setRenderPct] = useState(zoom.pct)
  useEffect(() => {
    const t = setTimeout(() => setRenderPct(zoom.pct), 160)
    return () => clearTimeout(t)
  }, [zoom.pct])

  // 100% = fit the page to the column width (the default way PDFs open).
  const scale = useMemo(() => {
    if (!base) return 1
    return Math.max(0.2, (containerW - 48) / base.w) * (renderPct / 100)
  }, [base, renderPct, containerW])
  const previewScale = zoom.pct / renderPct

  const numPages = pdf?.numPages ?? 0

  // report clearly-orphaned pdf annotations (page out of range)
  useEffect(() => {
    if (numPages === 0) return
    anno.onOrphans(
      anno.annos
        .filter((a) => {
          const l = a.anchor.locator
          return (l.type === 'pdf' || l.type === 'rect' || l.type === 'drawing') && l.page > numPages
        })
        .map((a) => a.id)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, anno.annos])

  const cssW = base ? base.w * scale : 0
  const cssH = base ? base.h * scale : 0
  const slot = cssH + GAP
  const firstVisible = slot > 0 ? Math.floor(scrollTop / slot) : 0
  const visibleCount = slot > 0 ? Math.ceil(viewH / slot) + 1 : 1
  const activeFrom = Math.max(0, firstVisible - BUFFER)
  const activeTo = Math.min(numPages - 1, firstVisible + visibleCount + BUFFER)
  const currentPage = Math.min(numPages, firstVisible + 1)

  const onScroll = (e: UIEvent<HTMLDivElement>): void => setScrollTop(e.currentTarget.scrollTop)
  useEffect(() => setPageInput(String(currentPage)), [currentPage])
  const jumpTo = useCallback((p: number) => {
    const el = scrollRef.current
    if (el && slot) el.scrollTop = (p - 1) * slot
  }, [slot])

  const controls = (
    <>
      <div className="pdf-pager">
        <input
          className="pdf-page-input"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const p = parseInt(pageInput, 10)
              if (p >= 1 && p <= numPages) jumpTo(p)
            }
          }}
        />
        <span className="pdf-page-total">/ {numPages}</span>
      </div>
      <ZoomControls zoom={zoom} onChange={onZoom} />
      <ReplaceFileButton onClick={() => onReplace(note.id)} />
      {note.state === 'library' && <AddToReviewButton onClick={() => onAddToReview(note.id)} />}
    </>
  )

  const title = <FileTitleInput note={note} onSaved={onSaved} />

  if (error) {
    return (
      <DocShell title={title} controls={controls}>
        <EmptyState icon={FileWarning} title="无法加载该 PDF" hint="文件可能已损坏,或不是受支持的格式" />
      </DocShell>
    )
  }

  return (
    <DocShell title={title} controls={controls} scrollRef={scrollRef} onScroll={onScroll}>
      {!pdf || !base ? (
        <div className="doc-skeleton" aria-busy><Skeleton lines={7} /></div>
      ) : (
        <div
          className="pdf-pages"
          style={previewScale !== 1 ? { transform: `scale(${previewScale})`, transformOrigin: 'top center' } : undefined}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              pageNumber={i + 1}
              scale={scale}
              active={i >= activeFrom && i <= activeTo}
              cssW={cssW}
              cssH={cssH}
              anno={anno}
            />
          ))}
        </div>
      )}
    </DocShell>
  )
}
