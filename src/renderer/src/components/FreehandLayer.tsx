import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { getStroke } from 'perfect-freehand'
import type { Annotation, DrawingLocator } from '../../../preload'
import { resolveColor } from '../lib/annoColors'
import type { PenProps, NewStroke } from '../lib/annoRender'
import { cutStroke, strokeTouched, type Pt } from '../lib/strokeGeom'

/** perfect-freehand outline points → an SVG fill path. */
function svgPath(points: number[][]): string {
  if (points.length === 0) return ''
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...points[0], 'Q'] as (string | number)[]
  )
  d.push('Z')
  return d.join(' ')
}

const PEN_OPTS = { thinning: 0.55, smoothing: 0.5, streamline: 0.5 }
// Highlighter: uniform width, no pressure taper, flat-ish ends.
const MARKER_OPTS = { thinning: 0, smoothing: 0.6, streamline: 0.55, simulatePressure: false }

interface Stroke {
  anno: Annotation
  pts: Pt[] // px
  sizePx: number
  tool: 'pen' | 'marker'
}

interface Props {
  page: number // pdf page number, or 0 for a single surface (image / html)
  annos: Annotation[]
  activeId: string | null
  pen: PenProps
}

/**
 * Freehand layer over a fixed-layout surface. Strokes are stored normalized to
 * the surface box so they scale exactly with zoom. In pen mode it captures
 * pointer input (pen / highlighter / eraser); otherwise it is inert
 * (pointer-events: none) so the text beneath stays selectable.
 */
export function FreehandLayer({ page, annos, activeId, pen }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [live, setLive] = useState<Pt[] | null>(null)
  const [erasePath, setErasePath] = useState<Pt[] | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const committing = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const strokes: Stroke[] = useMemo(
    () =>
      annos
        .filter((a) => a.type === 'drawing' && a.anchor.locator.type === 'drawing' && (a.anchor.locator as DrawingLocator).page === page)
        .map((a) => {
          const loc = a.anchor.locator as DrawingLocator
          return {
            anno: a,
            pts: loc.points.map(([nx, ny, p]) => [nx * box.w, ny * box.h, p ?? 0.5]),
            sizePx: loc.size * box.w,
            tool: loc.tool ?? 'pen'
          }
        }),
    [annos, page, box.w, box.h]
  )

  const eraserR = pen.sizePx / 2

  // Live eraser preview: which strokes vanish, which get cut into pieces.
  const erase = useMemo(() => {
    if (!erasePath) return null
    const removed = new Set<string>()
    const pieces = new Map<string, Pt[][]>()
    for (const s of strokes) {
      if (pen.eraserMode === 'stroke') {
        if (strokeTouched(s.pts, erasePath, eraserR + s.sizePx / 2)) removed.add(s.anno.id)
      } else {
        const runs = cutStroke(s.pts, erasePath, eraserR + s.sizePx * 0.3)
        if (runs) {
          removed.add(s.anno.id)
          if (runs.length) pieces.set(s.anno.id, runs)
        }
      }
    }
    return { removed, pieces }
  }, [erasePath, strokes, pen.eraserMode, eraserR])

  function pt(e: ReactPointerEvent): Pt {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]
  }
  function onDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!pen.active || e.button !== 0 || committing.current) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    if (pen.tool === 'eraser') setErasePath([pt(e)])
    else setLive([pt(e)])
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!pen.active) return
    const p = pt(e)
    if (pen.tool === 'eraser') setCursor({ x: p[0], y: p[1] })
    if (live) setLive((prev) => (prev ? [...prev, p] : prev))
    else if (erasePath) setErasePath((prev) => (prev ? [...prev, p] : prev))
  }
  async function onUp(): Promise<void> {
    if (box.w === 0) return
    const norm = (pts: Pt[]): number[][] => pts.map(([x, y, p]) => [x / box.w, y / box.h, p ?? 0.5])
    if (live) {
      const pts = live
      if (pts.length >= 2 && pen.tool !== 'eraser') {
        committing.current = true
        try {
          await pen.onCreate({ page, points: norm(pts), size: pen.sizePx / box.w, color: pen.color, tool: pen.tool })
        } finally {
          committing.current = false
        }
      }
      setLive(null)
    } else if (erasePath) {
      const res = erase
      if (res && res.removed.size > 0) {
        const removed = strokes.filter((s) => res.removed.has(s.anno.id))
        const added: NewStroke[] = []
        for (const s of removed) {
          const loc = s.anno.anchor.locator as DrawingLocator
          for (const run of res.pieces.get(s.anno.id) ?? []) {
            added.push({ page, points: norm(run), size: loc.size, color: s.anno.color, tool: s.tool })
          }
        }
        committing.current = true
        try {
          await pen.onEraseCommit(removed.map((s) => s.anno), added)
        } finally {
          committing.current = false
        }
      }
      setErasePath(null)
    }
  }

  const draw = (pts: Pt[], sizePx: number, color: string, tool: 'pen' | 'marker', key: string, id?: string, active?: boolean): JSX.Element => {
    // pen = solid colour; highlighter = the translucent version (multiplied over the page)
    const c = resolveColor(color)
    const line = tool === 'marker' ? c.bg : c.line
    const outline = getStroke(pts, { size: sizePx, ...(tool === 'marker' ? MARKER_OPTS : PEN_OPTS) })
    return (
      <path
        key={key}
        d={svgPath(outline)}
        fill={line}
        className={`fh-stroke fh-${tool}${active ? ' active' : ''}`}
        data-anno-id={id}
      />
    )
  }

  const toolClass = pen.active ? ` on tool-${pen.tool}` : ''
  return (
    <div
      ref={ref}
      className={`fh-layer${toolClass}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setCursor(null)}
    >
      <svg className="fh-svg" width={box.w} height={box.h}>
        {strokes.map((s) => {
          if (erase?.removed.has(s.anno.id)) {
            return (erase.pieces.get(s.anno.id) ?? []).map((run, i) => draw(run, s.sizePx, s.anno.color, s.tool, `${s.anno.id}-p${i}`))
          }
          return draw(s.pts, s.sizePx, s.anno.color, s.tool, s.anno.id, s.anno.id, activeId === s.anno.id)
        })}
        {live && pen.tool !== 'eraser' && draw(live, pen.sizePx, pen.color, pen.tool, 'live')}
        {pen.active && pen.tool === 'eraser' && cursor && (
          <circle className="fh-eraser-cursor" cx={cursor.x} cy={cursor.y} r={eraserR} />
        )}
      </svg>
    </div>
  )
}
