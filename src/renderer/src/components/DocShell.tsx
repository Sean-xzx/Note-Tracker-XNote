import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode, Ref, UIEvent } from 'react'
import { BookOpen, Highlighter, PenLine, SquareDashed, MessageSquareText, Minus, Plus, CalendarPlus, RefreshCw } from 'lucide-react'
import type { ZoomState } from '../lib/zoom'
import { clampPct, stepZoom } from '../lib/zoom'
import { useDocChrome, type DocMode } from '../lib/docChrome'
import { IconButton, Tooltip, ICON, usePresence } from './ui'

const MODES: { id: DocMode; label: string; icon: typeof BookOpen; key: string }[] = [
  { id: 'read', label: '阅读', icon: BookOpen, key: 'Esc' },
  { id: 'annotate', label: '标注', icon: Highlighter, key: '选中文字' },
  { id: 'pen', label: '画笔', icon: PenLine, key: 'P' }
]

/** Segmented 阅读 / 标注 / 画笔 switch in the document header. */
function ModeSwitch(): JSX.Element | null {
  const c = useDocChrome()
  if (!c) return null
  return (
    <div className="seg" role="tablist" aria-label="文档模式">
      {MODES.filter((m) => m.id !== 'pen' || c.canDraw).map((m) => (
        <Tooltip key={m.id} label={`${m.label}模式`} shortcut={m.key}>
          <button role="tab" aria-selected={c.mode === m.id} className={c.mode === m.id ? 'active' : ''} onClick={() => c.setMode(m.id)}>
            <m.icon size={ICON.sm} strokeWidth={ICON.stroke} />
            <span>{m.label}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * The unified document shell: header (title · mode · controls), an optional
 * slide-down tool bar, and the single scroll container hosting the content.
 * Ctrl+wheel / trackpad pinch zooms every document type from here.
 */
export function DocShell({
  title,
  controls,
  scrollRef,
  onScroll,
  children
}: {
  title: ReactNode
  controls?: ReactNode
  scrollRef?: Ref<HTMLDivElement>
  onScroll?: (e: UIEvent<HTMLDivElement>) => void
  children: ReactNode
}): JSX.Element {
  const chrome = useDocChrome()
  // the tool row keeps its space until the bar has finished leaving
  const bar = usePresence(!!chrome?.belowOpen)
  const elRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(chrome?.zoom)
  zoomRef.current = chrome?.zoom
  const onZoomRef = useRef(chrome?.onZoom)
  onZoomRef.current = chrome?.onZoom

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el
      if (typeof scrollRef === 'function') scrollRef(el)
      else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = el
    },
    [scrollRef]
  )

  // Ctrl+wheel and pinch (Chromium reports pinch as ctrl+wheel). Must be a
  // non-passive native listener so preventDefault stops page zoom/scroll.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || !zoomRef.current || !onZoomRef.current) return
      e.preventDefault()
      // ~10% per wheel notch (deltaY≈100); trackpad pinch sends small deltas → smooth
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const factor = Math.exp(-dy * 0.001)
      onZoomRef.current({ pct: clampPct(zoomRef.current.pct * factor) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scaleStyle = chrome ? ({ ['--doc-font-scale' as string]: chrome.zoom.pct / 100 } as CSSProperties) : undefined

  return (
    <>
      <div className="editor-header">
        <div className="eh-title">{title}</div>
        {chrome && (
          <div className="eh-mode">
            <ModeSwitch />
            {chrome.mode === 'annotate' && chrome.canRect && (
              <IconButton icon={SquareDashed} label="框选区域" active={chrome.rectMode} onClick={chrome.toggleRect} />
            )}
          </div>
        )}
        <div className="header-right">
          {controls}
          {chrome && (
            <IconButton
              icon={MessageSquareText}
              label="标注与复习"
              active={chrome.sidebarOpen}
              onClick={chrome.toggleSidebar}
              badge={chrome.annoCount > 0 ? chrome.annoCount : undefined}
              tooltipPlacement="bottom-end"
            />
          )}
        </div>
      </div>
      {chrome && (
        <div className={`below-header${bar.mounted ? ' open' : ''}${bar.leaving ? ' leaving' : ''}`} aria-hidden={!chrome.belowOpen}>
          <div className="below-header-inner">{chrome.below}</div>
        </div>
      )}
      <div className="doc-scroll" ref={setRefs} onScroll={onScroll} style={scaleStyle}>
        {children}
      </div>
    </>
  )
}

/** Zoom controls: − · level · +. Clicking the level resets to 100%. */
export function ZoomControls({ zoom, onChange }: { zoom: ZoomState; onChange: (z: ZoomState) => void }): JSX.Element {
  return (
    <div className="zoom-controls">
      <IconButton icon={Minus} small label="缩小" shortcut="Ctrl+滚轮" onClick={() => onChange({ pct: stepZoom(zoom.pct, -1) })} />
      <Tooltip label="重置为 100%">
        <button className="zoom-level" onClick={() => onChange({ pct: 100 })}>
          {Math.round(zoom.pct)}%
        </button>
      </Tooltip>
      <IconButton icon={Plus} small label="放大" shortcut="Ctrl+滚轮" onClick={() => onChange({ pct: stepZoom(zoom.pct, 1) })} />
    </div>
  )
}

export function AddToReviewButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button className="btn btn-secondary btn-sm" onClick={onClick} title="加入复习">
      <CalendarPlus size={ICON.sm} strokeWidth={ICON.stroke} />
      <span className="btn-label">加入复习</span>
    </button>
  )
}

export function ReplaceFileButton({ onClick }: { onClick: () => void }): JSX.Element {
  return <IconButton icon={RefreshCw} label="替换文件" onClick={onClick} />
}
