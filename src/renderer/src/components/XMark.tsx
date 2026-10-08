import { useEffect, useRef } from 'react'

export type XMarkState = 'static' | 'draw' | 'thinking'

/**
 * The XNote mark as inline SVG (same geometry as assets/brand/xnote-mark-animatable.svg):
 * a clay highlighter swipe under an ink stroke. States:
 *  - static   : the brand mark, at rest
 *  - draw     : one-shot — highlighter sweeps in (scaleX 0→1), then the ink draws
 *  - thinking : ink dimmed; highlighter loops swipe → hold → fade (waiting only)
 * The resting frame of every state is identical to the brand icon (no blend modes).
 * Colours come from --brand-clay / --brand-ink so a dark theme only swaps tokens.
 */
export function XMark({
  state = 'static',
  size = 20,
  className,
  onDrawn
}: {
  state?: XMarkState
  size?: number
  className?: string
  /** Fires once when the 'draw' animation has finished. */
  onDrawn?: () => void
}): JSX.Element {
  const ref = useRef<SVGSVGElement>(null)

  // Pause the loop while the mark is scrolled out of view.
  useEffect(() => {
    const el = ref.current
    if (state !== 'thinking' || !el) return
    const io = new IntersectionObserver(([e]) => el.classList.toggle('offscreen', !e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [state])

  return (
    <svg
      ref={ref}
      className={`xmark xmark-${state}${className ? ' ' + className : ''}`}
      viewBox="20 20 60 60"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      onAnimationEnd={(e) => {
        if (state === 'draw' && (e.target as Element).classList.contains('xn-ink')) onDrawn?.()
      }}
    >
      <g transform="translate(50 50) rotate(-50)">
        <polygon className="xn-hl" points="-26,-9 28,-9 24,9 -30,9" />
      </g>
      <line
        className="xn-ink"
        x1="31"
        y1="27"
        x2="69"
        y2="73"
        pathLength={1}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={1}
      />
    </svg>
  )
}
