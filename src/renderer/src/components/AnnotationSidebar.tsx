import { useEffect, useState } from 'react'
import { X, Trash2, Clock3, Highlighter, History, Quote } from 'lucide-react'
import type { Annotation, ReviewHistoryEntry } from '../../../preload'
import { resolveColor } from '../lib/annoColors'
import { relativeTime } from '../lib/annoTools'
import { ColorSwatchButton } from './ColorPicker'
import { IconButton, EmptyState, ICON } from './ui'
import { formatDay } from '../lib/format'

interface Props {
  /** Exit phase of the slide-out (kept mounted while it plays). */
  leaving?: boolean
  width: number
  noteId: string
  annos: Annotation[]
  orphanedIds: Set<string>
  activeId: string | null
  onLocate: (id: string) => void
  onChangeColor: (id: string, color: string) => void
  onEditNote: (id: string, text: string) => void
  onDelete: (id: string) => void
  onClose: () => void
  onOpenTimeline: () => void
}

const TYPE_LABEL: Record<string, string> = {
  highlight: '高亮',
  underline: '下划线',
  wavy: '波浪线',
  comment: '批注',
  rect: '框选',
  drawing: '手绘'
}
const RATING_LABEL: Record<number, string> = { 1: '忘了', 2: '模糊', 3: '记得', 4: '很熟' }

function AnnoCard({
  a,
  active,
  orphaned,
  onLocate,
  onChangeColor,
  onEditNote,
  onDelete
}: {
  a: Annotation
  active: boolean
  orphaned: boolean
  onLocate: (id: string) => void
  onChangeColor: (id: string, color: string) => void
  onEditNote: (id: string, text: string) => void
  onDelete: (id: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(a.note_text ?? '')
  const c = resolveColor(a.color)
  const loc = a.anchor.locator.type
  const emptyLabel = loc === 'rect' ? '框选区域' : loc === 'drawing' ? '手绘笔迹' : '（空）'

  return (
    <div className={`anno-card${active ? ' active' : ''}`}>
      <button className="anno-card-quote" onClick={() => !orphaned && onLocate(a.id)} disabled={orphaned}>
        <span className="anno-card-bar" style={{ background: c.line }} />
        <span className={`anno-card-text${a.quote ? '' : ' muted'}`}>{a.quote || emptyLabel}</span>
      </button>

      {a.type === 'comment' &&
        (editing ? (
          <textarea
            className="anno-note-input"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              setEditing(false)
              onEditNote(a.id, text)
            }}
          />
        ) : (
          <button className="anno-note" onClick={() => setEditing(true)}>
            {a.note_text || <span className="anno-note-empty">添加批注…</span>}
          </button>
        ))}

      <div className="anno-card-foot">
        <span className="anno-card-meta">
          {TYPE_LABEL[a.type] ?? a.type} · {relativeTime(a.created_at)}
        </span>
        <div className="anno-card-actions">
          <ColorSwatchButton color={a.color} onChange={(col) => onChangeColor(a.id, col)} title="颜色" />
          <IconButton icon={Trash2} small label="删除(可撤销 Ctrl+Z)" onClick={() => onDelete(a.id)} />
        </div>
      </div>
    </div>
  )
}

/** This document's review log + the reflections written at each review. */
function ReviewHistory({ noteId }: { noteId: string }): JSX.Element {
  const [rows, setRows] = useState<ReviewHistoryEntry[] | null>(null)
  useEffect(() => {
    let ok = true
    window.api.review.history(noteId).then((r) => ok && setRows(r))
    return () => {
      ok = false
    }
  }, [noteId])
  if (!rows) return <div className="side-loading" />
  if (rows.length === 0) return <EmptyState icon={History} title="还没有复习记录" hint="加入复习并完成一次后,这里会记录每次的评分与感悟" />
  return (
    <ol className="history-list">
      {rows.map((r) => (
        <li key={r.logId} className="history-item">
          <div className="history-head">
            <span className={`rating-chip r${r.rating}`}>{RATING_LABEL[r.rating]}</span>
            <span className="history-date">{formatDay(r.reviewedAt)}</span>
            <span className="history-next">下次 {r.intervalAfter} 天后</span>
          </div>
          {r.reflection && (
            <p className="history-reflection">
              <Quote size={ICON.xxs} strokeWidth={ICON.stroke} />
              {r.reflection}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Right panel: this file's annotations (with an orphaned group) and review history. */
export function AnnotationSidebar({
  leaving,
  width,
  noteId,
  annos,
  orphanedIds,
  activeId,
  onLocate,
  onChangeColor,
  onEditNote,
  onDelete,
  onClose,
  onOpenTimeline
}: Props): JSX.Element {
  const [tab, setTab] = useState<'annos' | 'review'>('annos')
  const live = annos.filter((a) => !orphanedIds.has(a.id))
  const orphans = annos.filter((a) => orphanedIds.has(a.id))
  const card = (a: Annotation, orphaned: boolean): JSX.Element => (
    <AnnoCard
      key={a.id}
      a={a}
      active={activeId === a.id}
      orphaned={orphaned}
      onLocate={onLocate}
      onChangeColor={onChangeColor}
      onEditNote={onEditNote}
      onDelete={onDelete}
    />
  )

  return (
    <aside className={`anno-sidebar side-panel panel-motion${leaving ? ' leaving' : ''}`} style={{ width }}>
      <div className="side-head">
        <div className="seg sm">
          <button className={tab === 'annos' ? 'active' : ''} onClick={() => setTab('annos')}>
            标注{annos.length > 0 && <span className="seg-count">{annos.length}</span>}
          </button>
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            复习与感悟
          </button>
        </div>
        <IconButton icon={X} small label="关闭" onClick={onClose} tooltipPlacement="bottom-end" />
      </div>

      <div className="side-body">
        {tab === 'review' ? (
          <ReviewHistory noteId={noteId} />
        ) : annos.length === 0 ? (
          <EmptyState icon={Highlighter} title="还没有标注" hint="切换到「标注」后选中文字,或用「画笔」直接书写" />
        ) : (
          <>
            {live.map((a) => card(a, false))}
            {orphans.length > 0 && (
              <>
                <div className="side-section">失配的标注 · 原文可能已改动</div>
                {orphans.map((a) => card(a, true))}
              </>
            )}
          </>
        )}
      </div>

      <button className="side-foot-link" onClick={onOpenTimeline}>
        <Clock3 size={ICON.xs} strokeWidth={ICON.stroke} />
        标注时间线
      </button>
    </aside>
  )
}
