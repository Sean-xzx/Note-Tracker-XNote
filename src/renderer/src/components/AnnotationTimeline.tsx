import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnnotationWithNote } from '../../../preload'
import { ANNO_COLORS, colorByToken } from '../lib/annoColors'
import { relativeTime } from '../lib/annoTools'
import { ArrowLeft, Highlighter, MessageSquare, Search } from 'lucide-react'
import { EmptyState, IconButton, ICON } from './ui'
import { formatDay } from '../lib/format'

/** Cross-file annotation timeline (also a data source for Step 5's review). */
export function AnnotationTimeline({
  onOpen,
  onClose
}: {
  onOpen: (noteId: string, annoId: string) => void
  onClose: () => void
}): JSX.Element {
  const [all, setAll] = useState<AnnotationWithNote[]>([])
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [fileFilter, setFileFilter] = useState('')

  const reload = useCallback(async () => {
    setAll(await window.api.annotations.listAll())
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const filtered = useMemo(
    () =>
      all.filter(
        (a) =>
          (!colorFilter || a.color === colorFilter) &&
          (!fileFilter || a.note_title.toLowerCase().includes(fileFilter.toLowerCase()))
      ),
    [all, colorFilter, fileFilter]
  )

  // Group by calendar day.
  const groups = useMemo(() => {
    const m = new Map<string, AnnotationWithNote[]>()
    for (const a of filtered) {
      const day = formatDay(a.created_at)
      if (!m.has(day)) m.set(day, [])
      m.get(day)!.push(a)
    }
    return [...m.entries()]
  }, [filtered])

  return (
    <>
      <div className="editor-header">
        <div className="eh-title">
          <IconButton icon={ArrowLeft} label="返回文件库" onClick={onClose} />
          <span className="doc-title">标注时间线</span>
        </div>
        <div className="header-right">
          <label className="field field-sm">
            <Search size={ICON.xs} strokeWidth={ICON.stroke} />
            <input placeholder="按文件名筛选" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} />
          </label>
          <div className="tl-color-filter">
            <button
              className={`anno-swatch sm ${colorFilter === null ? 'active' : ''}`}
              title="全部颜色"
              style={{ background: 'var(--text-faint)' }}
              onClick={() => setColorFilter(null)}
            />
            {ANNO_COLORS.map((c) => (
              <button
                key={c.token}
                className={`anno-swatch sm ${colorFilter === c.token ? 'active' : ''}`}
                title={c.label}
                style={{ background: c.line }}
                onClick={() => setColorFilter(c.token)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="doc-scroll tl-scroll">
        {filtered.length === 0 ? (
          <EmptyState icon={Highlighter} title="还没有标注" hint="在任意文件里划重点后,这里会按时间列出" />
        ) : (
          <div className="tl-list">
            {groups.map(([day, list]) => (
              <div key={day} className="tl-group">
                <div className="tl-day">{day}</div>
                {list.map((a) => {
                  const c = colorByToken(a.color)
                  return (
                    <button key={a.id} className="tl-item" onClick={() => onOpen(a.note_id, a.id)}>
                      <span className="tl-bar" style={{ background: c.line }} />
                      <div className="tl-item-main">
                        <div className={`tl-quote${a.quote ? '' : ' muted'}`}>
                          {a.quote || (a.type === 'drawing' ? '手绘笔迹' : a.type === 'rect' ? '框选区域' : '（空）')}
                        </div>
                        {a.note_text && <div className="tl-note"><MessageSquare size={ICON.xxs} strokeWidth={ICON.stroke} />{a.note_text}</div>}
                        <div className="tl-meta">
                          {a.note_title} · 划于 {relativeTime(a.created_at)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
