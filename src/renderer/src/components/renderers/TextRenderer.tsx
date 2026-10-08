import { useState } from 'react'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import { useAutosave } from '../../lib/useAutosave'
import { handleTextareaTab } from '../../lib/textareaTab'
import type { AnnoRenderProps } from '../../lib/annoRender'
import { DocShell, ZoomControls, AddToReviewButton } from '../DocShell'
import { SaveStatus } from '../ui'
import { FileTitleInput } from '../FileTitleInput'
import { HtmlAnnoView } from '../HtmlAnnoView'
import { useDocChrome } from '../../lib/docChrome'

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  anno: AnnoRenderProps
}

function isJson(note: Note): boolean {
  const ext = (note.original_name?.split('.').pop() ?? '').toLowerCase()
  return ext === 'json' || note.mime_type === 'application/json'
}
async function loadTextFile(id: string, json: boolean): Promise<string> {
  const bytes = await window.api.files.getBytes(id)
  let t = bytes ? new TextDecoder('utf-8').decode(bytes) : ''
  if (json) {
    try {
      t = JSON.stringify(JSON.parse(t), null, 2)
    } catch {
      /* leave as-is */
    }
  }
  return t
}

/**
 * Editable text/code/json. Highlights are shown in a read-only "预览" mode (a
 * <pre> substrate with real, selectable text) — reliable and pixel-accurate —
 * while editing happens in the textarea (no inline highlight overlay).
 */
export function TextRenderer({ note, zoom, onZoom, onSaved, onAddToReview, anno }: Props): JSX.Element {
  const chrome = useDocChrome()
  const [mode, setMode] = useState<'edit' | 'preview'>(chrome?.preferRead ? 'preview' : 'edit')
  const view = chrome?.mode === 'pen' ? 'preview' : mode
  const json = isJson(note)
  const { content, status, onChange } = useAutosave({
    id: note.id,
    load: (id) => loadTextFile(id, json),
    save: (id, c) => window.api.files.saveText(id, c),
    onSaved
  })

  const controls = (
    <>
      <SaveStatus status={status} />
      <ZoomControls zoom={zoom} onChange={onZoom} />
      <div className="seg sm" role="tablist" aria-label="编辑 / 阅读">
        <button className={view === 'edit' ? 'active' : ''} disabled={chrome?.mode === 'pen'} onClick={() => setMode('edit')}>编辑</button>
        <button className={view === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>阅读</button>
      </div>
      {note.state === 'library' && <AddToReviewButton onClick={() => onAddToReview(note.id)} />}
    </>
  )

  return (
    <DocShell title={<FileTitleInput note={note} onSaved={onSaved} />} controls={controls}>
      {view === 'edit' ? (
        <textarea
          className="doc-textarea mono"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => handleTextareaTab(e)}
          spellCheck={false}
        />
      ) : (
        <HtmlAnnoView text={content} anno={anno} substrateClass="doc-textarea mono" />
      )}
    </DocShell>
  )
}
