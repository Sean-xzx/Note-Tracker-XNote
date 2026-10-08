import { useEffect, useLayoutEffect } from 'react'
import { useFloating, autoUpdate, offset, flip, shift, FloatingPortal } from '@floating-ui/react'
import type { LucideIcon } from 'lucide-react'
import { ICON } from './ui'

export interface MenuItem {
  label?: string
  icon?: LucideIcon
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  sep?: boolean
}

/**
 * Context menu at (x, y). Positioned by floating-ui against a virtual point so
 * it flips/shifts to stay inside the window. Closes on outside click/scroll.
 */
export function TreeContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  const { refs, floatingStyles, placement } = useFloating({
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(2), flip({ padding: 8 }), shift({ padding: 8 })]
  })
  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({ x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y })
    })
  }, [refs, x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="popover menu ctx-menu"
        data-side={placement.split('-')[0]}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.sep ? (
            <div className="menu-sep" key={i} />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item${it.danger ? ' danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                it.onClick?.()
                onClose()
              }}
            >
              <span className="menu-icon">{it.icon && <it.icon size={ICON.sm} strokeWidth={ICON.stroke} />}</span>
              <span className="menu-text">{it.label}</span>
            </button>
          )
        )}
      </div>
    </FloatingPortal>
  )
}
