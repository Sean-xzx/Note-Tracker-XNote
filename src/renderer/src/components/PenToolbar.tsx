import { PenLine, Highlighter, Eraser, ChevronDown, Undo2, Redo2, Check } from 'lucide-react'
import type { PenTool, EraserMode } from '../lib/annoRender'
import { IconButton, Popover, Tooltip, ICON } from './ui'
import { ColorButton } from './ColorPicker'

/** Size levels (screen px) per tool: three dots in the bar. */
export const PEN_SIZES: Record<PenTool, number[]> = {
  pen: [2, 4, 7],
  marker: [12, 18, 26],
  eraser: [10, 18, 30]
}

const ERASER_MODES: { m: EraserMode; name: string; hint: string }[] = [
  { m: 'stroke', name: '整笔擦除', hint: '碰到就删除整条笔迹' },
  { m: 'partial', name: '局部擦除', hint: '只擦掉经过的部分' }
]

interface Props {
  tool: PenTool
  onTool: (t: PenTool) => void
  eraserMode: EraserMode
  onEraserMode: (m: EraserMode) => void
  sizeIdx: number
  onSizeIdx: (i: number) => void
  color: string
  onColor: (c: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** Grouped pen tools: [pen · marker · eraser▾] | [size] | [color] | [undo · redo]. */
export function PenToolbar(p: Props): JSX.Element {
  const dot = (i: number): number => [6, 10, 15][i]
  return (
    <div className="pen-bar" role="toolbar" aria-label="画笔工具">
      <div className="tb-group">
        <IconButton icon={PenLine} label="钢笔" shortcut="P" active={p.tool === 'pen'} onClick={() => p.onTool('pen')} />
        <IconButton icon={Highlighter} label="荧光笔" shortcut="H" active={p.tool === 'marker'} onClick={() => p.onTool('marker')} />
        <div className={`split-btn${p.tool === 'eraser' ? ' active' : ''}`}>
          <IconButton
            icon={Eraser}
            label={p.eraserMode === 'stroke' ? '橡皮擦 · 整笔' : '橡皮擦 · 局部'}
            shortcut="E"
            active={p.tool === 'eraser'}
            onClick={() => p.onTool('eraser')}
          />
          <Popover
            placement="bottom-start"
            className="menu"
            trigger={
              <button className="split-caret" aria-label="橡皮擦模式">
                <ChevronDown size={ICON.xxs} strokeWidth={ICON.stroke} />
              </button>
            }
          >
            {(close) => (
              <>
                {ERASER_MODES.map(({ m, name, hint }) => (
                  <button
                    key={m}
                    className="menu-item"
                    onClick={() => {
                      p.onEraserMode(m)
                      p.onTool('eraser')
                      close()
                    }}
                  >
                    <span className="menu-check">{p.eraserMode === m && <Check size={ICON.xs} strokeWidth={ICON.stroke} />}</span>
                    <span className="menu-text">
                      <span>{name}</span>
                      <span className="menu-hint">{hint}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </Popover>
        </div>
      </div>

      <span className="tb-sep" />

      <div className="tb-group" aria-label="粗细">
        {[0, 1, 2].map((i) => (
          <Tooltip key={i} label={['细', '中', '粗'][i]}>
            <button className={`size-btn${p.sizeIdx === i ? ' active' : ''}`} onClick={() => p.onSizeIdx(i)} aria-label={['细', '中', '粗'][i]}>
              <span
                className={`size-dot${p.tool === 'eraser' ? ' ring' : ''}${p.tool === 'marker' ? ' soft' : ''}`}
                style={{ width: dot(i), height: dot(i) }}
              />
            </button>
          </Tooltip>
        ))}
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <ColorButton color={p.color} onChange={p.onColor} label="颜色" />
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <IconButton icon={Undo2} label="撤销" shortcut="Ctrl+Z" disabled={!p.canUndo} onClick={p.onUndo} />
        <IconButton icon={Redo2} label="重做" shortcut="Ctrl+Shift+Z" disabled={!p.canRedo} onClick={p.onRedo} />
      </div>
      <span className="pen-bar-hint">
        <kbd>Esc</kbd> 退出画笔
      </span>
    </div>
  )
}
