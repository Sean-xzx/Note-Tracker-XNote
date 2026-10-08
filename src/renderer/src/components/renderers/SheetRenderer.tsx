import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import * as XLSX from 'xlsx'
import type { Note } from '../../../../preload'
import type { ZoomState } from '../../lib/zoom'
import { Skeleton, EmptyState } from '../ui'
import { FileWarning } from 'lucide-react'
import { paintCharAnnos, hitTest, type AnnoRenderProps, type LocalRect } from '../../lib/annoRender'
import { DocShell, ZoomControls, AddToReviewButton, ReplaceFileButton } from '../DocShell'
import { FileTitleInput } from '../FileTitleInput'

const MAX_ROWS = 2000 // guard against megarow files locking up the UI

interface Sheet {
  name: string
  rows: unknown[][]
  truncated: number // rows beyond the cap, or 0
}

interface Props {
  note: Note
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  anno: AnnoRenderProps
}

function isCsv(note: Note): boolean {
  const ext = (note.original_name?.split('.').pop() ?? '').toLowerCase()
  return ext === 'csv' || note.mime_type === 'text/csv'
}

function capRows(rows: unknown[][]): { rows: unknown[][]; truncated: number } {
  if (rows.length <= MAX_ROWS) return { rows, truncated: 0 }
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length - MAX_ROWS }
}

export function SheetRenderer({ note, zoom, onZoom, onSaved, onAddToReview, onReplace, anno }: Props): JSX.Element {
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const rectsRef = useRef<Map<string, LocalRect[]>>(new Map())

  useEffect(() => {
    const overlay = overlayRef.current
    const sub = subRef.current
    if (!overlay || !sub) return
    const res = paintCharAnnos(overlay, sub, anno.annos, anno.activeAnnoId)
    rectsRef.current = res.rectsById
    anno.onOrphans(res.orphaned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, active, anno.annos, anno.activeAnnoId])

  function onClick(e: ReactMouseEvent): void {
    const overlay = overlayRef.current
    if (!overlay) return
    const r = overlay.getBoundingClientRect()
    const id = hitTest(rectsRef.current, e.clientX - r.left, e.clientY - r.top)
    if (id) anno.onAnnoClick(id)
  }

  useEffect(() => {
    let ok = true
    setSheets(null)
    setActive(0)
    setError(false)
    window.api.files.getBytes(note.id).then((bytes) => {
      if (!bytes) {
        if (ok) setError(true)
        return
      }
      try {
        let result: Sheet[]
        if (isCsv(note)) {
          const wb = XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string' })
          const name = wb.SheetNames[0]
          const all = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false })
          const c = capRows(all)
          result = [{ name: 'CSV', rows: c.rows, truncated: c.truncated }]
        } else {
          const wb = XLSX.read(bytes, { type: 'array' })
          result = wb.SheetNames.map((name) => {
            const all = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false })
            const c = capRows(all)
            return { name, rows: c.rows, truncated: c.truncated }
          })
        }
        if (ok) setSheets(result)
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
      {note.state === 'library' && (
        <AddToReviewButton onClick={() => onAddToReview(note.id)} />
      )}
    </>
  )

  const cur = sheets?.[active]

  return (
    <DocShell title={<FileTitleInput note={note} onSaved={onSaved} />} controls={controls}>
      {error ? (
        <EmptyState icon={FileWarning} title="无法解析该表格文件" hint="文件可能已损坏,或不是受支持的格式" />
      ) : !sheets || !cur ? (
        <div className="doc-skeleton" aria-busy><Skeleton lines={7} /></div>
      ) : (
        <div className="sheet-view">
          {sheets.length > 1 && (
            <div className="sheet-tabs">
              {sheets.map((s, i) => (
                <button
                  key={s.name + i}
                  className={`sheet-tab ${i === active ? 'active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="html-anno-wrap" onClick={onClick}>
          <div className="anno-overlay" ref={overlayRef} />
          <div className="sheet-table doc-substrate" ref={subRef}>
            <table>
              <tbody>
                {cur.rows.map((row, r) => (
                  <tr key={r}>
                    {(row as unknown[]).map((cell, c) =>
                      r === 0 ? <th key={c}>{String(cell ?? '')}</th> : <td key={c}>{String(cell ?? '')}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {cur.truncated > 0 && (
              <div className="sheet-truncated">表格较大,已仅显示前 {MAX_ROWS} 行(其余 {cur.truncated} 行未显示)。</div>
            )}
          </div>
          </div>
        </div>
      )}
    </DocShell>
  )
}
