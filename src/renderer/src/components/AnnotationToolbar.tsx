import { useLayoutEffect } from 'react'
import { useFloating, autoUpdate, offset, flip, shift, FloatingPortal } from '@floating-ui/react'
import { Highlighter, Underline, Waves, MessageSquarePlus } from 'lucide-react'
import type { AnnoType } from '../../../preload'
import { IconButton } from './ui'
import { ColorButton } from './ColorPicker'

type TextTool = Extract<AnnoType, 'highlight' | 'underline' | 'wavy' | 'comment'>

interface Props {
  /** Viewport rect of the current selection (the popup anchors to it). */
  rect: { x: number; y: number; width: number; height: number }
  color: string
  onCreate: (type: TextTool) => void
  onPickColor: (color: string) => void
}

/** Floating tool strip shown on a text selection in 标注 mode. */
export function AnnotationToolbar({ rect, color, onCreate, onPickColor }: Props): JSX.Element {
  const { refs, floatingStyles, placement } = useFloating({
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })]
  })
  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height
      })
    })
  }, [refs, rect])

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="anno-popup popover"
        data-side={placement.split('-')[0]}
        // keep the text selection alive while clicking tools
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
        }}
      >
        <IconButton icon={Highlighter} label="高亮" onClick={() => onCreate('highlight')} tooltipPlacement="top" />
        <IconButton icon={Underline} label="下划线" onClick={() => onCreate('underline')} tooltipPlacement="top" />
        <IconButton icon={Waves} label="波浪线" onClick={() => onCreate('wavy')} tooltipPlacement="top" />
        <IconButton icon={MessageSquarePlus} label="批注" onClick={() => onCreate('comment')} tooltipPlacement="top" />
        <span className="tb-sep" />
        <ColorButton color={color} onChange={onPickColor} label="颜色" placement="bottom" />
      </div>
    </FloatingPortal>
  )
}
