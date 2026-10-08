import { useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, CSSProperties, RefObject } from 'react'
import { paintCharAnnos, hitTest, type AnnoRenderProps, type LocalRect } from '../lib/annoRender'
import { FreehandLayer } from './FreehandLayer'

/**
 * Renders a text substrate (rendered HTML, or preformatted text) with a
 * character-level annotation overlay (behind the text) and a freehand drawing
 * layer (above it). No original DOM is mutated. Shared by the docx /
 * markdown-preview / text read views.
 */
export function HtmlAnnoView({
  html,
  text,
  anno,
  substrateClass,
  style
}: {
  html?: string
  text?: string
  anno: AnnoRenderProps
  substrateClass?: string
  style?: CSSProperties
}): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLElement>(null)
  const rectsRef = useRef<Map<string, LocalRect[]>>(new Map())
  const annoRef = useRef(anno)
  annoRef.current = anno

  useEffect(() => {
    const overlay = overlayRef.current
    const sub = subRef.current
    if (!overlay || !sub) return
    const res = paintCharAnnos(overlay, sub, anno.annos, anno.activeAnnoId)
    rectsRef.current = res.rectsById
    anno.onOrphans(res.orphaned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, anno.annos, anno.activeAnnoId])

  // Re-measure + repaint when the substrate reflows (zoom / width change).
  useEffect(() => {
    const sub = subRef.current
    const overlay = overlayRef.current
    if (!sub || !overlay) return
    const ro = new ResizeObserver(() => {
      const a = annoRef.current
      const res = paintCharAnnos(overlay, sub, a.annos, a.activeAnnoId)
      rectsRef.current = res.rectsById
    })
    ro.observe(sub)
    return () => ro.disconnect()
  }, [])

  function onClick(e: ReactMouseEvent): void {
    if (anno.pen.active) return
    const overlay = overlayRef.current
    if (!overlay) return
    const r = overlay.getBoundingClientRect()
    const id = hitTest(rectsRef.current, e.clientX - r.left, e.clientY - r.top)
    if (id) anno.onAnnoClick(id)
  }

  return (
    <div className="html-anno-wrap" onClick={onClick}>
      <div className="anno-overlay" ref={overlayRef} />
      {text != null ? (
        <pre
          ref={subRef as RefObject<HTMLPreElement>}
          className={`doc-substrate read ${substrateClass ?? ''}`}
          style={style}
        >
          {text}
        </pre>
      ) : (
        <div
          ref={subRef as RefObject<HTMLDivElement>}
          className={`doc-view doc-substrate ${substrateClass ?? ''}`}
          style={style}
          dangerouslySetInnerHTML={{ __html: html ?? '' }}
        />
      )}
      <FreehandLayer page={0} annos={anno.annos} activeId={anno.activeAnnoId} pen={anno.pen} />
    </div>
  )
}
