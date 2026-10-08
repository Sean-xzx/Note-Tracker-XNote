import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, CSSProperties } from 'react'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import { resolveColor } from '../../lib/annoColors'
import type { AnnoRenderProps } from '../../lib/annoRender'
import { DocShell, ZoomControls, AddToReviewButton, ReplaceFileButton } from '../DocShell'
import { FileTitleInput } from '../FileTitleInput'
import { FreehandLayer } from '../FreehandLayer'

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  anno: AnnoRenderProps
}

export function ImageRenderer({ note, zoom, onZoom, onSaved, onAddToReview, onReplace, anno }: Props): JSX.Element {
  const [natW, setNatW] = useState(0)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const url = window.api.files.imageUrl(note.id)

  useEffect(() => {
    anno.onOrphans([]) // rect anchors are position-based; never orphaned
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anno.annos])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageW(el.clientWidth))
    ro.observe(el)
    setStageW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 100% = fit the column width (small images are never upscaled past natural size).
  const base = natW && stageW ? Math.min(natW, Math.max(80, stageW - 48)) : 0
  const style: CSSProperties = base
    ? { width: (base * zoom.pct) / 100, maxWidth: 'none', height: 'auto' }
    : { maxWidth: '100%', height: 'auto' }

  function norm(e: ReactMouseEvent): { x: number; y: number } | null {
    const el = holderRef.current
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
    if (d.w > 0.01 && d.h > 0.01) anno.onCreateRect(0, d.x, d.y, d.w, d.h)
  }

  const controls = (
    <>
      <ZoomControls zoom={zoom} onChange={onZoom} />
      <ReplaceFileButton onClick={() => onReplace(note.id)} />
      {note.state === 'library' && <AddToReviewButton onClick={() => onAddToReview(note.id)} />}
    </>
  )

  return (
    <DocShell title={<FileTitleInput note={note} onSaved={onSaved} />} controls={controls}>
      <div className="image-stage" ref={stageRef}>
        <div
          className={`image-holder ${anno.rectMode ? 'rect-mode' : ''}`}
          ref={holderRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
        >
          <img className="doc-image" src={url} alt="" style={style} onLoad={(e) => setNatW(e.currentTarget.naturalWidth)} />
          {anno.annos.map((a) => {
            const loc = a.anchor.locator
            if (loc.type !== 'rect') return null
            const c = resolveColor(a.color)
            const style: CSSProperties = {
              left: `${loc.x * 100}%`,
              top: `${loc.y * 100}%`,
              width: `${loc.w * 100}%`,
              height: `${loc.h * 100}%`,
              ['--c-bg' as string]: c.bg,
              ['--c-line' as string]: c.line
            }
            return (
              <div
                key={a.id}
                className={`img-anno-rect ${anno.activeAnnoId === a.id ? 'active' : ''}`}
                data-anno-id={a.id}
                onClick={() => anno.onAnnoClick(a.id)}
                style={style}
              />
            )
          })}
          {draft && (
            <div
              className="img-anno-rect draft"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
            />
          )}
          <FreehandLayer page={0} annos={anno.annos} activeId={anno.activeAnnoId} pen={anno.pen} />
        </div>
      </div>
    </DocShell>
  )
}
