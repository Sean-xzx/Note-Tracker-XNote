/**
 * Motion bookkeeping for text annotations. Only an annotation the user has just
 * created gets the marker sweep; anything painted because a document opened,
 * scrolled, zoomed or reflowed shows instantly.
 *
 * A fresh id plays on its first paint. If a repaint happens mid-sweep (the
 * overlay is rebuilt on reflow) the sweep resumes at the elapsed point via a
 * negative delay instead of restarting; once it has finished it is forgotten.
 */
const SWEEP_MS = 200
const LINE_STAGGER_MS = 40
const fresh = new Map<string, number | null>() // id → first-paint time

export function markFresh(id: string): void {
  fresh.set(id, null)
}

/**
 * Sweep timing for a fresh annotation's painted rects, or null when it should
 * just appear. Rects are grouped into visual lines; each line sweeps as one
 * continuous stroke (a fragment gets the slice of time matching its x-span, so
 * a bold run inside a line does not restart the sweep), and lines follow each
 * other 40ms apart.
 */
export function sweepTiming(
  id: string,
  rects: { x: number; y: number; w: number; h: number }[]
): { delay: number; dur: number }[] | null {
  if (!fresh.has(id)) return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fresh.delete(id)
    return null
  }
  // group into lines by vertical centre
  const lines: { cy: number; x0: number; x1: number }[] = []
  const lineOf = rects.map((r) => {
    const cy = r.y + r.h / 2
    let i = lines.findIndex((l) => Math.abs(l.cy - cy) < r.h / 2)
    if (i < 0) i = lines.push({ cy, x0: r.x, x1: r.x + r.w }) - 1
    else {
      lines[i].x0 = Math.min(lines[i].x0, r.x)
      lines[i].x1 = Math.max(lines[i].x1, r.x + r.w)
    }
    return i
  })
  const order = lines.map((l, i) => [l.cy, i]).sort((p, q) => p[0] - q[0]).map((p) => p[1])
  const rank = new Map(order.map((li, k) => [li, k]))

  const now = performance.now()
  let t0 = fresh.get(id) ?? null
  if (t0 === null) {
    t0 = now
    fresh.set(id, t0)
  }
  const elapsed = now - t0
  if (elapsed >= SWEEP_MS + LINE_STAGGER_MS * (lines.length - 1)) {
    fresh.delete(id)
    return null
  }
  return rects.map((r, i) => {
    const l = lines[lineOf[i]]
    const span = Math.max(1, l.x1 - l.x0)
    const start = ((r.x - l.x0) / span) * SWEEP_MS
    const dur = Math.max(40, (r.w / span) * SWEEP_MS)
    return { delay: (rank.get(lineOf[i]) ?? 0) * LINE_STAGGER_MS + start - elapsed, dur }
  })
}

/**
 * Fade an annotation's painted parts out (120ms) before it is removed, so a
 * delete never pops. Resolves when the fade is done (immediately if nothing is
 * painted or motion is reduced).
 */
export function fadeOutAnno(root: ParentNode | null, id: string): Promise<void> {
  const els = root ? [...root.querySelectorAll(`[data-anno-id="${CSS.escape(id)}"]`)] : []
  if (els.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
  for (const el of els) el.classList.add('anno-leaving')
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-micro')) || 120
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * For annotations painted as text marks (the markdown editor): true exactly once
 * for a freshly created annotation, so its mark plays the sweep on first paint.
 */
export function takeFresh(id: string): boolean {
  if (!fresh.has(id)) return false
  fresh.delete(id)
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
