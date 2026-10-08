import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Placement } from '@floating-ui/react'
import { ANNO_COLORS, PRESET_HEX, isHex, hsvToHex, hexToHsv, loadRecentColors, swatchOf } from '../lib/annoColors'
import { Popover, Tooltip } from './ui'

/**
 * Drag helper: the first pointerdown already "jumps" to the clicked spot, then
 * window-level move/up listeners keep the gesture alive anywhere on screen
 * (pointer capture is also requested, but the gesture never depends on it).
 */
function useDrag(onPoint: (fx: number, fy: number) => void): {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
} {
  const cb = useRef(onPoint)
  cb.current = onPoint
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* not essential */
      }
      const at = (x: number, y: number): void => {
        const r = el.getBoundingClientRect()
        cb.current(Math.min(1, Math.max(0, (x - r.left) / r.width)), Math.min(1, Math.max(0, (y - r.top) / r.height)))
      }
      at(e.clientX, e.clientY)
      const move = (ev: PointerEvent): void => at(ev.clientX, ev.clientY)
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
  }
}

/** The picker body: saturation/value panel → hue → [swatch + hex] → presets → recent. */
export function ColorPanel({ color, onChange }: { color: string; onChange: (color: string) => void }): JSX.Element {
  const seedHex = isHex(color) ? color : PRESET_HEX[color] ?? PRESET_HEX.yellow
  const [hsv, setHsv] = useState(() => hexToHsv(seedHex))
  const [hexText, setHexText] = useState(seedHex)
  const [recent] = useState(loadRecentColors)
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  // Follow external changes (e.g. picking a preset) without fighting a drag.
  useEffect(() => {
    const hex = isHex(color) ? color : PRESET_HEX[color]
    if (!hex) return
    if (hsvToHex(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v).toLowerCase() !== hex.toLowerCase()) {
      setHsv(hexToHsv(hex))
    }
    setHexText(hex)
  }, [color])

  const emit = (h: number, s: number, v: number): void => {
    setHsv({ h, s, v })
    const hex = hsvToHex(h, s, v)
    setHexText(hex)
    onChange(hex)
  }
  const svDrag = useDrag((fx, fy) => emit(hsvRef.current.h, fx, 1 - fy))
  const hueDrag = useDrag((fx) => emit(Math.min(359.9, fx * 360), hsvRef.current.s, hsvRef.current.v))

  const hueHex = hsvToHex(hsv.h, 1, 1)
  const cur = hsvToHex(hsv.h, hsv.s, hsv.v)
  // Keep a text selection alive while using the picker, but let the hex input focus.
  const keepSelection = (e: ReactMouseEvent): void => {
    if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
  }

  return (
    <div className="color-panel" onMouseDown={keepSelection}>
      <div className="cp-sv" style={{ backgroundColor: hueHex }} {...svDrag}>
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div className="cp-sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: cur }} />
      </div>
      <div className="cp-hue" role="slider" aria-label="色相" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} {...hueDrag}>
        <div className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }} />
      </div>
      <div className="cp-row">
        <span className="cp-current" style={{ background: cur }} />
        <input
          className="cp-hex"
          value={hexText}
          spellCheck={false}
          aria-label="十六进制颜色"
          onChange={(e) => {
            const v = e.target.value.trim()
            setHexText(v)
            if (isHex(v)) {
              setHsv(hexToHsv(v))
              onChange(v)
            }
          }}
        />
      </div>
      <div className="cp-group">
        <div className="cp-label">预设</div>
        <div className="cp-swatches">
          {ANNO_COLORS.map((c) => (
            <Tooltip key={c.token} label={c.label} placement="top">
              <button className={`cp-swatch${color === c.token ? ' active' : ''}`} style={{ background: c.line }} onClick={() => onChange(c.token)} />
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="cp-group">
        <div className="cp-label">最近使用</div>
        <div className="cp-swatches">
          {recent.length === 0 && <span className="cp-none">使用过的颜色会出现在这里</span>}
          {recent.map((c) => (
            <button
              key={c}
              title={c}
              className={`cp-swatch${color.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
              style={{ background: swatchOf(c) }}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** A color dot that opens the picker in a collision-aware popover. */
export function ColorButton({
  color,
  onChange,
  label = '颜色',
  placement = 'bottom'
}: {
  color: string
  onChange: (c: string) => void
  label?: string
  placement?: Placement
}): JSX.Element {
  return (
    <Popover
      placement={placement}
      className="cp-popover"
      trigger={
        <button className="color-dot-btn" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()}>
          <span className="color-dot" style={{ background: swatchOf(color) }} />
        </button>
      }
    >
      <ColorPanel color={color} onChange={onChange} />
    </Popover>
  )
}

/** Back-compat name used by the annotation sidebar. */
export const ColorSwatchButton = ({ color, onChange, title }: { color: string; onChange: (c: string) => void; title?: string }): JSX.Element => (
  <ColorButton color={color} onChange={onChange} label={title} placement="left" />
)
