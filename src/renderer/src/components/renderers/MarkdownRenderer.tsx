import { useEffect, useState } from 'react'
import { CodeXml, SquarePen, Check } from 'lucide-react'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import type { SaveStatus as Status } from '../../lib/useAutosave'
import type { AnnoRenderProps } from '../../lib/annoRender'
import type { RenderMode } from '../../lib/md/livePreview'
import { DocShell, ZoomControls } from '../DocShell'
import { SaveStatus, IconButton, ICON } from '../ui'
import { MdEditor } from '../MdEditor'
import { useDocChrome } from '../../lib/docChrome'

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  anno: AnnoRenderProps
}

const SOURCE_KEY = 'xnote.md.sourceMode'
const loadSource = (): boolean => {
  try {
    return localStorage.getItem(SOURCE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Markdown note: one editor that renders as you write (Typora-style live
 * preview), with a full-source mode (Ctrl+/). 标注 / 画笔 and review show the
 * fully rendered document read-only; review can switch to editing.
 */
export function MarkdownRenderer({ note, zoom, onZoom, onSaved, anno }: Props): JSX.Element {
  const chrome = useDocChrome()
  const [source, setSource] = useState(loadSource)
  const [editing, setEditing] = useState(!chrome?.preferRead)
  const [status, setStatus] = useState<Status>('idle')
  useEffect(() => setEditing(!chrome?.preferRead), [note.id, chrome?.preferRead])

  const docMode = chrome?.mode ?? 'read'
  const readOnly = docMode !== 'read' || !editing
  // drawing always happens on the rendered page, never on source
  const mode: RenderMode = docMode === 'pen' ? 'rendered' : source ? 'source' : readOnly ? 'rendered' : 'live'
  const toggleSource = (): void =>
    setSource((v) => {
      try {
        localStorage.setItem(SOURCE_KEY, v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })

  const controls = (
    <>
      <SaveStatus status={status} />
      {chrome?.preferRead && docMode === 'read' && (
        <button className={`btn btn-sm ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing((v) => !v)}>
          {editing ? <Check size={ICON.sm} strokeWidth={ICON.stroke} /> : <SquarePen size={ICON.sm} strokeWidth={ICON.stroke} />}
          <span className="btn-label">{editing ? '完成' : '编辑'}</span>
        </button>
      )}
      <ZoomControls zoom={zoom} onChange={onZoom} />
      <IconButton icon={CodeXml} label="源码模式" shortcut="Ctrl+/" active={source} disabled={docMode === 'pen'} onClick={toggleSource} />
    </>
  )

  return (
    <DocShell title={<span className="doc-title">{note.title.trim() || '无标题'}</span>} controls={controls}>
      <div className="reading-column">
        <MdEditor
          note={note}
          mode={mode}
          readOnly={readOnly}
          scale={zoom.pct / 100}
          anno={anno}
          onStatus={setStatus}
          onSaved={onSaved}
          onToggleSource={toggleSource}
        />
      </div>
    </DocShell>
  )
}
