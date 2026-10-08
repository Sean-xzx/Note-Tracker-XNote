import { cloneElement, forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  useHover,
  useFocus,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  type Placement
} from '@floating-ui/react'
import type { LucideIcon } from 'lucide-react'

/** Consistent icon rendering: one stroke width, two sizes. */
export const ICON = {
  xxs: 12, // glyphs inside chips / meta lines
  xs: 14, // inline with text, small controls
  sm: 16, // default (buttons, nav, tree)
  md: 18,
  lg: 22, // empty states
  xl: 28, // large placeholders
  stroke: 1.75,
  strokeLight: 1.5 // only for lg/xl decorative icons
} as const

/**
 * Hover/focus tooltip (name + optional shortcut). Positioned with floating-ui
 * so it flips/shifts to stay inside the viewport; portaled out of any clip.
 */
export function Tooltip({
  label,
  shortcut,
  placement = 'bottom',
  children
}: {
  label: ReactNode
  shortcut?: string
  placement?: Placement
  children: ReactElement
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context, placement: side } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(7), flip({ padding: 8 }), shift({ padding: 8 })]
  })
  const hover = useHover(context, { delay: { open: 400, close: 0 }, move: false })
  const focus = useFocus(context, { visibleOnly: true })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])
  return (
    <>
      {cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="tooltip" data-side={side.split('-')[0]} {...getFloatingProps()}>
            <span>{label}</span>
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  small?: boolean
  tooltipPlacement?: Placement
  badge?: ReactNode
}

/** Ghost icon button with a tooltip. `active` = selected tool (soft accent). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, active, small, tooltipPlacement, badge, className, ...rest },
  ref
) {
  return (
    <Tooltip label={label} shortcut={shortcut} placement={tooltipPlacement}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={`icon-btn${small ? ' sm' : ''}${active ? ' active' : ''}${className ? ' ' + className : ''}`}
        {...rest}
      >
        <Icon size={ICON.sm} strokeWidth={ICON.stroke} />
        {badge != null && <span className="icon-badge">{badge}</span>}
      </button>
    </Tooltip>
  )
})

/**
 * Click-to-open popover anchored to `trigger`. Flips/shifts to stay fully in
 * the viewport, portaled, closes on outside click / Escape.
 */
export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
  className,
  open: openProp,
  onOpenChange
}: {
  trigger: ReactElement
  children: ReactNode | ((close: () => void) => ReactNode)
  placement?: Placement
  className?: string
  open?: boolean
  onOpenChange?: (o: boolean) => void
}): JSX.Element {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean): void => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  const { refs, floatingStyles, context, placement: finalPlacement } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 10 }),
      shift({ padding: 10 }),
      size({
        padding: 10,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`
        }
      })
    ]
  })
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])
  const close = (): void => setOpen(false)
  return (
    <>
      {cloneElement(trigger, getReferenceProps({ ref: refs.setReference, ...trigger.props }))}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={`popover${className ? ' ' + className : ''}`}
            data-side={finalPlacement.split('-')[0]}
            {...getFloatingProps()}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

/** Small "icon + one line" empty state. */
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): JSX.Element {
  return (
    <div className="empty-state">
      <Icon size={ICON.lg} strokeWidth={ICON.strokeLight} />
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  )
}

/** Reads the motion token (ms) so JS timing always matches the CSS. */
export function motionMs(token: '--dur-micro' | '--dur-base' | '--dur-panel' | '--dur-micro-out' | '--dur-base-out' | '--dur-panel-out'): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token))
  return Number.isFinite(v) ? v : 0
}

/**
 * Mount/unmount with an exit phase: while `open` turns false the element stays
 * mounted with `leaving` = true for the exit duration, then unmounts.
 */
export function usePresence(open: boolean, exitToken: Parameters<typeof motionMs>[0] = '--dur-panel-out'): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setLeaving(true)
    const t = setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, motionMs(exitToken))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return { mounted: mounted || open, leaving: leaving && !open }
}

/** Static placeholder blocks while content loads (no shimmer). */
export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }): JSX.Element {
  return (
    <div className={`skeleton${className ? ' ' + className : ''}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${[92, 78, 85, 64, 88][i % 5]}%` }} />
      ))}
    </div>
  )
}

/** Highlighter-style progress bar: clay fill with a slanted end, eased width. */
export function HlProgress({ value, className }: { value: number; className?: string }): JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className={`hl-progress${className ? ' ' + className : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span className="hl-progress-fill" style={{ width: `${pct}%` }} />
    </span>
  )
}

/**
 * Height reveal for tree children: expands/collapses over --dur-base (180ms),
 * children stay mounted until the collapse finishes. Content that is already
 * open on first render just appears (nothing moves on load).
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }): JSX.Element | null {
  const { mounted, leaving } = usePresence(open, '--dur-base-out')
  const [expanded, setExpanded] = useState(open)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (open && !expanded) {
      ref.current?.getBoundingClientRect() // commit the collapsed frame first
      setExpanded(true)
    } else if (!open && expanded) setExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!mounted) return null
  return (
    <div ref={ref} className={`collapse${expanded && !leaving ? ' open' : ''}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  )
}

/** "保存中… / 已保存" cross-fade (120ms) in a fixed-width slot — never jumps. */
export function SaveStatus({ status }: { status: 'idle' | 'saving' | 'saved' }): JSX.Element {
  return (
    <span className="save-status" aria-live="polite">
      <span className={status === 'saving' ? 'on' : ''}>保存中…</span>
      <span className={status === 'saved' ? 'on' : ''}>已保存</span>
    </span>
  )
}

// ---- In-app dialogs (replace window.confirm / window.prompt) -----------------
// Electron does not implement window.prompt(), and native confirm() boxes use the
// OS style/language. These render in the app's own elevated style instead.
interface DialogReq {
  kind: 'confirm' | 'prompt'
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  defaultValue?: string
  inputType?: 'text' | 'date'
  min?: string
  resolve: (v: boolean | string | null) => void
}
let showDialog: ((r: DialogReq) => void) | null = null

export function confirmDialog(o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showDialog) return resolve(false)
    showDialog({ kind: 'confirm', ...o, resolve: (v) => resolve(v === true) })
  })
}
export function promptDialog(o: { title: string; message?: string; defaultValue?: string; confirmLabel?: string; inputType?: 'text' | 'date'; min?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!showDialog) return resolve(null)
    showDialog({ kind: 'prompt', ...o, resolve: (v) => resolve(typeof v === 'string' ? v : null) })
  })
}

/** Mounted once at the app root. */
export function DialogHost(): JSX.Element | null {
  const [req, setReq] = useState<DialogReq | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    showDialog = (r) => {
      setValue(r.defaultValue ?? '')
      setReq(r)
    }
    return () => {
      showDialog = null
    }
  }, [])
  useEffect(() => {
    if (!req) return
    if (req.kind === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else okRef.current?.focus()
  }, [req])
  if (!req) return null
  const close = (v: boolean | string | null): void => {
    req.resolve(v)
    setReq(null)
  }
  const ok = (): void => close(req.kind === 'prompt' ? value : true)
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(req.kind === 'prompt' ? null : false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={(e) => {
          // keep app shortcuts (Esc → read mode, Enter → submit review…) out of the dialog
          e.stopPropagation()
          if (e.key === 'Escape') close(req.kind === 'prompt' ? null : false)
          else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            ok()
          }
        }}
      >
        <div className="dialog-title" id="dialog-title">
          {req.title}
        </div>
        {req.message && <div className="dialog-message">{req.message}</div>}
        {req.kind === 'prompt' && (
          <input ref={inputRef} className="dialog-input" type={req.inputType ?? 'text'} min={req.min} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => close(req.kind === 'prompt' ? null : false)}>
            取消
          </button>
          <button ref={okRef} className={`btn btn-primary${req.danger ? ' danger' : ''}`} onClick={ok}>
            {req.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
