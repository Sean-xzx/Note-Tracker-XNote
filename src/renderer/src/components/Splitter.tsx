import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  /** Horizontal pixel delta as the handle is dragged (incremental). */
  onDrag: (dx: number) => void
  /** Double-click: restore the neighbouring column's default width. */
  onReset?: () => void
}

/**
 * Column divider shared by every resizable panel. Visually a 1px low-contrast
 * hairline; the hit area is ~9px wide but invisible. On hover (after a short
 * delay) or while dragging it becomes a 3px accent line. Double-click resets.
 */
export function Splitter({ onDrag, onReset }: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const onDragRef = useRef(onDrag)
  onDragRef.current = onDrag
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* window listeners below carry the gesture anyway */
    }
    let last = e.clientX
    setDragging(true)
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - last
      if (dx !== 0) {
        onDragRef.current(dx)
        last = ev.clientX
      }
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.classList.remove('resizing')
      setDragging(false)
      cleanup.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    cleanup.current = end
  }

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度 · 双击恢复默认"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  )
}
