// Vector geometry for the eraser. Strokes stay point lists (never bitmaps):
// a whole-stroke erase deletes strokes the eraser touches; a partial erase cuts
// each touched stroke where the eraser passed and keeps the surviving runs as
// new strokes. All coordinates here are in screen px of one surface.

export type Pt = number[] // [x, y, pressure?]

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Shortest distance from a point to a polyline (a single point counts). */
export function distToPolyline(p: Pt, line: Pt[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1])
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const d = distToSegment(p[0], p[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1])
    if (d < best) best = d
  }
  return best
}

/** Resample so consecutive points are at most `step` apart (pressure interpolated). */
export function densify(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(d / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 0.5) + ((b[2] ?? 0.5) - (a[2] ?? 0.5)) * t])
    }
  }
  return out
}

/** Does the eraser path come within `reach` of the stroke? */
export function strokeTouched(stroke: Pt[], eraserPath: Pt[], reach: number): boolean {
  const dense = densify(stroke, Math.max(1, reach * 0.5))
  return dense.some((p) => distToPolyline(p, eraserPath) <= reach)
}

/**
 * Partial erase: remove the parts of `stroke` within `reach` of the eraser path.
 * Returns null if the stroke is untouched, otherwise the surviving runs
 * (each ≥ 2 points; an empty array means the stroke was fully erased).
 */
export function cutStroke(stroke: Pt[], eraserPath: Pt[], reach: number): Pt[][] | null {
  const dense = densify(stroke, Math.max(0.75, reach * 0.35))
  const keep = dense.map((p) => distToPolyline(p, eraserPath) > reach)
  if (keep.every(Boolean)) return null
  const runs: Pt[][] = []
  let cur: Pt[] = []
  dense.forEach((p, i) => {
    if (keep[i]) cur.push(p)
    else if (cur.length) {
      runs.push(cur)
      cur = []
    }
  })
  if (cur.length) runs.push(cur)
  return runs.filter((r) => r.length >= 2)
}
