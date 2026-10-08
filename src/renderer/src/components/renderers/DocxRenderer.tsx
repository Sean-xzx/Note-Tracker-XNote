import { useEffect, useState } from 'react'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import { Skeleton, EmptyState } from '../ui'
import { FileWarning } from 'lucide-react'
import type { AnnoRenderProps } from '../../lib/annoRender'
import { DocShell, ZoomControls, AddToReviewButton, ReplaceFileButton } from '../DocShell'
import { FileTitleInput } from '../FileTitleInput'
import { HtmlAnnoView } from '../HtmlAnnoView'

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em"
]

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  anno: AnnoRenderProps
}

export function DocxRenderer({ note, zoom, onZoom, onSaved, onAddToReview, onReplace, anno }: Props): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let ok = true
    setHtml(null)
    setError(false)
    window.api.files.getBytes(note.id).then(async (bytes) => {
      if (!bytes) return ok && setError(true)
      try {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const result = await mammoth.convertToHtml(
          { arrayBuffer: ab },
          {
            styleMap: STYLE_MAP,
            convertImage: mammoth.images.imgElement(async (image) => ({
              src: `data:${image.contentType};base64,${await image.read('base64')}`
            }))
          }
        )
        if (ok) setHtml(DOMPurify.sanitize(result.value))
      } catch {
        if (ok) setError(true)
      }
    })
    return () => {
      ok = false
    }
  }, [note.id])

  const controls = (
    <>
      <ZoomControls zoom={zoom} onChange={onZoom} />
      <ReplaceFileButton onClick={() => onReplace(note.id)} />
      {note.state === 'library' && <AddToReviewButton onClick={() => onAddToReview(note.id)} />}
    </>
  )

  return (
    <DocShell title={<FileTitleInput note={note} onSaved={onSaved} />} controls={controls}>
      {error ? (
        <EmptyState icon={FileWarning} title="无法解析该 Word 文档" hint="文件可能已损坏,或不是受支持的格式" />
      ) : html === null ? (
        <div className="doc-skeleton" aria-busy><Skeleton lines={7} /></div>
      ) : (
        <div className="reading-column">
          <HtmlAnnoView html={html} anno={anno} />
        </div>
      )}
    </DocShell>
  )
}
