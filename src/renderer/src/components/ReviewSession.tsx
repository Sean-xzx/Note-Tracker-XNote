import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ArrowRight, CalendarCheck, GripVertical, EyeOff, Eye, X, Quote, ChevronRight, SkipForward } from 'lucide-react'
import type { QueueItem, QueueResult, ReviewHistoryEntry, Rating, ReviewPrefs } from '../../../preload'
import { FileKindIcon } from '../lib/fileIcon'
import { DocumentView } from './DocumentView'
import { EmptyState, IconButton, HlProgress, Skeleton, Tooltip, ICON, motionMs, usePresence } from './ui'
import { XMark } from './XMark'
import { formatDay } from '../lib/format'

const RATINGS: { r: Rating; label: string; hint: string }[] = [
  { r: 1, label: '忘了', hint: '想不起要点,或者理解错了' },
  { r: 2, label: '模糊', hint: '想起来了,但很吃力或不完整' },
  { r: 3, label: '记得', hint: '经过思考,能用自己的话说出要点' },
  { r: 4, label: '很熟', hint: '不假思索,能讲给别人听' }
]

/** "3 天后", "约 2 个月后", "约 1.5 年后" */
function laterLabel(days: number): string {
  if (days < 60) return `${days} 天后`
  if (days < 365) return `约 ${Math.round(days / 30)} 个月后`
  return `约 ${Math.round((days / 365) * 10) / 10} 年后`
}

const IDLE_CAP_MS = 10 * 60_000

/**
 * Time spent on one note, from opening it to submitting the rating. Any idle
 * stretch (no key / pointer / scroll / wheel) longer than 10 minutes counts as
 * 10 minutes.
 */
function useActiveTime(key: string | undefined): () => number {
  const acc = useRef({ total: 0, last: 0 })
  useEffect(() => {
    if (!key) return
    acc.current = { total: 0, last: performance.now() }
    const touch = (): void => {
      const now = performance.now()
      acc.current.total += Math.min(now - acc.current.last, IDLE_CAP_MS)
      acc.current.last = now
    }
    const evs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll'] as const
    for (const e of evs) window.addEventListener(e, touch, { passive: true, capture: true })
    return () => {
      for (const e of evs) window.removeEventListener(e, touch, { capture: true })
    }
  }, [key])
  return () => {
    const now = performance.now()
    return acc.current.total + Math.min(now - acc.current.last, IDLE_CAP_MS)
  }
}

function groupChip(q: QueueItem): JSX.Element {
  if (q.group === 'overdue') return <span className="q-chip overdue">逾期 {q.overdueDays} 天</span>
  if (q.group === 'new') return <span className="q-chip new">新内容</span>
  return <span className="q-chip due">今日到期</span>
}

interface Props {
  onExit: () => void
  onChanged: () => void
  onSaved: () => void
  onAddToReview: (id: string) => void
  onReplace: (id: string) => void
  onOpenTimeline: () => void
  /** the document currently under review (null in overview / done), for the AI panel */
  onCurrentChange: (note: { id: string; title: string } | null) => void
}

type Phase = 'loading' | 'overview' | 'reviewing' | 'done'

/**
 * A focused review session. Overview (ordered queue) → read each document in
 * full → "完成这篇" opens a docked recap panel (reflection + 4-level rating) →
 * next → summary. The session walks its own queue, so a "忘了" rating never
 * leaves you stuck on the same note (the old bug: a forgotten note stayed due
 * today and was re-selected as the head of the due list).
 */
export function ReviewSession({
  onExit,
  onChanged,
  onSaved,
  onAddToReview,
  onReplace,
  onOpenTimeline,
  onCurrentChange
}: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<QueueItem[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [queueInfo, setQueueInfo] = useState<Omit<QueueResult, 'items'> | null>(null)
  const [prefs, setPrefs] = useState<ReviewPrefs | null>(null)
  const [preview, setPreview] = useState<Record<Rating, { interval: number; due: string }> | null>(null)
  // 先回想再看: the note opens as a recall prompt until 「展开」 / Space
  const [revealed, setRevealed] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [recallQuotes, setRecallQuotes] = useState<string[]>([])
  const [pos, setPos] = useState(0) // index into the active list
  const [panelOpen, setPanelOpen] = useState(false)
  const recap = usePresence(panelOpen)
  const [docLeaving, setDocLeaving] = useState(false)
  const [rating, setRating] = useState<Rating | null>(null)
  const [reflection, setReflection] = useState('')
  const [past, setPast] = useState<ReviewHistoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{
    reviewedToday: number
    reflectionsToday: number
    dueTomorrow: number
  } | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    Promise.all([window.api.review.queue(), window.api.review.prefs()]).then(([q, p]) => {
      const { items: list, ...info } = q
      setItems(list)
      setQueueInfo(info)
      setPrefs(p)
      setPhase('overview')
    })
  }, [])

  const active = items.filter((q) => !skipped.has(q.note.id))
  const current = phase === 'reviewing' ? active[pos] : undefined
  const elapsed = useActiveTime(current?.note.id)

  // tell the app which document is on screen; cleared when the session unmounts
  useEffect(() => {
    onCurrentChange(current ? { id: current.note.id, title: current.note.title } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.note.id, current?.note.title])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onCurrentChange(null), [])

  // per note: next-interval preview for the rating buttons + the recall phase
  useEffect(() => {
    if (!current) return
    let ok = true
    setPreview(null)
    window.api.review.preview(current.note.id).then((p) => ok && setPreview(p))
    const recall = !!prefs?.recallFirst
    setRevealed(!recall)
    setCountdown(recall ? prefs!.recallSeconds : 0)
    setRecallQuotes([])
    if (recall && prefs!.recallShowHighlights)
      window.api.annotations.list(current.note.id).then((a) => {
        if (ok) setRecallQuotes(a.filter((x) => x.type !== 'drawing' && x.type !== 'rect' && x.quote.trim()).map((x) => x.quote.trim()))
      })
    return () => {
      ok = false
    }
  }, [current?.note.id, prefs])
  useEffect(() => {
    if (revealed || countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [revealed, countdown])
  // Space shows the full text during the recall phase
  useEffect(() => {
    if (phase !== 'reviewing' || revealed) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (e.key !== ' ' || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return
      e.preventDefault()
      setRevealed(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, revealed])

  // load earlier reflections for the recap panel
  useEffect(() => {
    if (!current) return
    let ok = true
    window.api.review.history(current.note.id).then((h) => ok && setPast(h.filter((e) => e.reflection)))
    return () => {
      ok = false
    }
  }, [current?.note.id])

  const finish = useCallback(async () => {
    setPhase('done')
    setSummary(await window.api.review.summary())
    onChanged()
  }, [onChanged])

  const advance = useCallback(() => {
    if (docLeaving) return
    setPanelOpen(false)
    setRating(null)
    setReflection('')
    if (pos + 1 >= active.length) {
      finish()
      return
    }
    // old document fades out (120ms), the next one fades in from the top
    setDocLeaving(true)
    setTimeout(() => {
      setPos((p) => p + 1)
      setDocLeaving(false)
    }, motionMs('--dur-micro'))
  }, [pos, active.length, finish, docLeaving])

  const submit = useCallback(async () => {
    if (!current || rating == null || busy) return
    setBusy(true)
    try {
      await window.api.review.complete(current.note.id, rating, reflection, elapsed())
      advance()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, rating, reflection, busy, advance])

  // Keyboard inside the recap panel: 1–4 rate, Enter submits, Esc closes.
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent): void => {
      const inText = (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      if (e.key === 'Escape') {
        setPanelOpen(false)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        submit()
        return
      }
      if (!inText && ['1', '2', '3', '4'].includes(e.key)) setRating(Number(e.key) as Rating)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, submit])

  useEffect(() => {
    if (panelOpen) setTimeout(() => textRef.current?.focus(), 180)
  }, [panelOpen])

  // ---- overview: drag to reorder ----
  function onDragStart(i: number): void {
    dragRef.current = i
    setDragIdx(i)
  }
  function onDragOver(e: DragEvent, i: number): void {
    e.preventDefault()
    setOverIdx(i)
  }
  function onDrop(i: number): void {
    const from = dragRef.current
    if (from == null || from === i) return reset()
    setItems((prev) => {
      const next = prev.slice()
      const [m] = next.splice(from, 1)
      next.splice(i, 0, m)
      return next
    })
    reset()
  }
  function reset(): void {
    dragRef.current = null
    setDragIdx(null)
    setOverIdx(null)
  }

  if (phase === 'loading')
    return (
      <div className="review-page">
        <div className="review-overview">
          <Skeleton lines={4} />
        </div>
      </div>
    )

  if (phase === 'overview') {
    // estimated minutes = the average recorded time per note of each parameter group (4 min without records)
    const minutes = Math.round(active.reduce((s, q) => s + q.estMinutes, 0))
    const cut = (queueInfo?.cutByTime ?? 0) + (queueInfo?.cutByLimit ?? 0)
    const heldBack = queueInfo?.newHeldBack ?? 0
    return (
      <div className="review-page">
        <div className="review-overview">
          <header className="rv-head">
            <h2>今日复习</h2>
            <div className="rv-sub">
              {new Date().toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'long'
              })}
            </div>
          </header>
          {items.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="今天没有需要复习的内容"
              hint="加入复习的文件会按遗忘曲线在这里出现"
            />
          ) : (
            <>
              <div className="rv-stats">
                <div>
                  <b>{active.length}</b> 篇
                </div>
                <div>
                  预计 <b>{minutes}</b> 分钟
                </div>
                {heldBack > 0 && <div className="rv-muted">另有 {heldBack} 篇新内容超出今日上限</div>}
              </div>
              {(cut > 0 || minutes > (queueInfo?.targetMinutes ?? Infinity)) && (
                <div className="rv-over">
                  {queueInfo && queueInfo.cutByTime > 0
                    ? `已达到每日复习时长目标(${queueInfo.targetMinutes} 分钟),另有 ${cut} 篇顺延到明天,到期日不变。`
                    : cut > 0
                      ? `已达到每日复习上限,另有 ${cut} 篇顺延到明天,到期日不变。`
                      : `预计用时超过每日复习时长目标(${queueInfo?.targetMinutes} 分钟)。`}
                </div>
              )}
              <ol className="rv-list">
                {items.map((q, i) => {
                  const off = skipped.has(q.note.id)
                  return (
                    <li
                      key={q.note.id}
                      className={`rv-row${off ? ' off' : ''}${overIdx === i && dragIdx !== i ? ' drop' : ''}${dragIdx === i ? ' dragging' : ''}`}
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragOver={(e) => onDragOver(e, i)}
                      onDrop={() => onDrop(i)}
                      onDragEnd={reset}
                    >
                      <GripVertical size={ICON.sm} strokeWidth={ICON.stroke} className="rv-grip" />
                      <span className="rv-num">{off ? '–' : active.indexOf(q) + 1}</span>
                      <FileKindIcon note={q.note} />
                      <span className="rv-title">{q.note.title || '无标题'}</span>
                      {groupChip(q)}
                      <IconButton
                        small
                        icon={off ? Eye : EyeOff}
                        label={off ? '恢复到今日' : '今天跳过'}
                        onClick={() =>
                          setSkipped((prev) => {
                            const n = new Set(prev)
                            if (n.has(q.note.id)) n.delete(q.note.id)
                            else n.add(q.note.id)
                            return n
                          })
                        }
                      />
                    </li>
                  )
                })}
              </ol>
              <div className="rv-foot">
                <span className="rv-muted">拖动调整顺序 · 最容易遗忘的排在前面,新内容在最后</span>
                <button
                  className="btn btn-primary"
                  disabled={active.length === 0}
                  onClick={() => {
                    setPos(0)
                    setPhase('reviewing')
                  }}
                >
                  开始复习
                  <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="review-page">
        <div className="review-done">
          <XMark state="draw" size={40} className="done-mark" />
          <h2>今日复习完成</h2>
          <div className="done-stats">
            <div>
              <b>{summary?.reviewedToday ?? '–'}</b>
              <span>今天复习</span>
            </div>
            <div>
              <b>{summary?.reflectionsToday ?? '–'}</b>
              <span>写下感悟</span>
            </div>
            <div>
              <b>{summary?.dueTomorrow ?? '–'}</b>
              <span>明天待复习</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={onExit}>
            返回文件库
          </button>
        </div>
      </div>
    )
  }

  // ---- reviewing ----
  if (!current) return <div className="review-page" />
  const isLast = pos + 1 >= active.length
  return (
    <div className="review-stage">
      <div className="review-main">
        <div className={`review-doc${docLeaving ? ' leaving' : ''}`} key={current.note.id}>
          {revealed ? (
            <DocumentView
              key={current.note.id}
              note={current.note}
              onSaved={onSaved}
              onAddToReview={onAddToReview}
              onReplace={onReplace}
              onOpenTimeline={onOpenTimeline}
              preferRead
            />
          ) : (
            <div className="recall-stage">
              <div className="recall-card">
                <FileKindIcon note={current.note} />
                <h2 className="recall-title">{current.note.title || '无标题'}</h2>
                <p className="recall-prompt">先回想这篇的要点</p>
                <div className={`recall-timer${countdown <= 0 ? ' done' : ''}`} aria-live="polite">
                  {countdown > 0 ? `${countdown} 秒` : '可以展开了'}
                </div>
                {recallQuotes.length > 0 && (
                  <div className="recall-quotes">
                    <div className="recall-quotes-label">已划的重点</div>
                    <ul>
                      {recallQuotes.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => setRevealed(true)}>
                  <Eye size={ICON.sm} strokeWidth={ICON.stroke} />
                  展开
                  <kbd>空格</kbd>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="review-bar">
          <div className="review-progress">
            <span className="rp-count">
              {pos + 1} / {active.length}
            </span>
            <span className="rp-dot">·</span>
            <span className="rp-title">{current.note.title || '无标题'}</span>
            <HlProgress className="rp-track" value={pos / active.length} />
          </div>
          <div className="review-actions">
            <button className="btn btn-ghost" onClick={advance} disabled={busy || docLeaving}>
              <SkipForward size={ICON.sm} strokeWidth={ICON.stroke} />
              跳过
            </button>
            <button className="btn btn-primary" onClick={() => setPanelOpen(true)} disabled={panelOpen}>
              完成这篇
              <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} />
            </button>
          </div>
        </div>
      </div>

      {recap.mounted && (
        <aside className={`recap-panel panel-motion${recap.leaving ? ' leaving' : ''}`}>
          <div className="recap-inner">
            <div className="recap-head">
              <div>
                <div className="recap-title">回顾</div>
                <div className="recap-sub">{current.note.title || '无标题'}</div>
              </div>
              <IconButton icon={X} small label="继续阅读" shortcut="Esc" onClick={() => setPanelOpen(false)} />
            </div>

            <label className="recap-label" htmlFor="recap-text">
              这次有什么新的理解?<span>选填</span>
            </label>
            <textarea
              id="recap-text"
              ref={textRef}
              className="recap-text"
              placeholder="写下一两句就好…"
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
            />

            <div className="recap-label">记忆程度</div>
            <div className="rating-row" role="radiogroup" aria-label="记忆程度">
              {RATINGS.map((x) => (
                <Tooltip key={x.r} label={x.hint} placement="top">
                  <button
                    role="radio"
                    aria-checked={rating === x.r}
                    aria-description={x.hint}
                    className={`rating-btn r${x.r}${rating === x.r ? ' active' : ''}`}
                    onClick={() => setRating(x.r)}
                  >
                    <span className="rating-main">
                      <kbd>{x.r}</kbd>
                      {x.label}
                    </span>
                    <span className="rating-next">{preview ? laterLabel(preview[x.r].interval) : ' '}</span>
                  </button>
                </Tooltip>
              ))}
            </div>

            {past.length > 0 && (
              <details className="recap-past">
                <summary>
                  <ChevronRight size={ICON.xs} strokeWidth={ICON.stroke} />
                  之前的感悟 · {past.length}
                </summary>
                <ol>
                  {past.map((p) => (
                    <li key={p.logId}>
                      <span className="recap-past-date">{formatDay(p.reviewedAt)}</span>
                      <p>
                        <Quote size={ICON.xxs} strokeWidth={ICON.stroke} />
                        {p.reflection}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            <div className="recap-foot">
              <span className="recap-keys">
                <kbd>1</kbd>–<kbd>4</kbd> 评分 · <kbd>Enter</kbd> 提交
              </span>
              <button className="btn btn-primary" disabled={rating == null || busy} onClick={submit}>
                {isLast ? '完成复习' : '下一篇'}
                <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} />
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
