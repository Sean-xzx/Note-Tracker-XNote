import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getNote, getDueNotes, updateNote, nowIso, todayDate, localDayRange, type Note } from './notes'
import {
  DEFAULT_PARAMS,
  DEFAULT_W,
  sanitizeParams,
  nextMemory,
  retrievability,
  schedule,
  simulate,
  addDays,
  dayDiff,
  localDay,
  type GroupParams,
  type Grade,
  type Memory
} from './fsrs'

// Spaced repetition with FSRS (see fsrs.ts for the interval rules).
//
// notes columns: stability / difficulty = FSRS memory state, interval_days =
// the last scheduled interval, due_date = local YYYY-MM-DD, state new | review
// (| library for files not in review), reps = successful reviews, lapses =
// "忘了" after the first review. Parameters live in parameter groups: a
// folder can be assigned a group, which its whole subtree then uses.
export type Rating = Grade

const DEFAULT_GROUP = 'default'
const IDLE_CAP_MS = 10 * 60_000 // an idle stretch counts at most 10 minutes
const DEFAULT_MINUTES_PER_ITEM = 4
const AVG_SAMPLE = 30

// ---------------------------------------------------------------------------
// Parameter groups
// ---------------------------------------------------------------------------
interface GroupRow {
  id: string
  name: string
  params: string
  is_default: number
  created_at: string
}
export interface ParamGroup {
  id: string
  name: string
  isDefault: boolean
  params: GroupParams
  folders: { id: string; title: string }[]
  totalReviews: number
  /** set when the group's review count reached 100 / 200 / 400 … since the last optimization */
  optimizeHint: number | null
}

function groupRows(): GroupRow[] {
  return getDb().prepare(`SELECT * FROM param_groups ORDER BY is_default DESC, created_at ASC`).all() as GroupRow[]
}
function parseParams(json: string): GroupParams {
  try {
    return sanitizeParams(JSON.parse(json))
  } catch {
    return sanitizeParams(DEFAULT_PARAMS)
  }
}
export function groupParams(id: string): GroupParams {
  const row = getDb().prepare(`SELECT params FROM param_groups WHERE id = ?`).get(id) as { params: string } | undefined
  return row ? parseParams(row.params) : groupParams(DEFAULT_GROUP)
}

/** Minimal view of the tree used to resolve groups and exam dates. */
interface TreeNode {
  id: string
  parent_id: string | null
  kind: string
  title: string
  exam_date: string | null
  param_group_id: string | null
}
function treeMap(): Map<string, TreeNode> {
  const rows = getDb().prepare(`SELECT id, parent_id, kind, title, exam_date, param_group_id FROM notes WHERE deleted_at IS NULL`).all() as TreeNode[]
  return new Map(rows.map((r) => [r.id, r]))
}
/** Nearest folder (the item itself for a folder) with a group assigned; else the default group. */
function groupOf(id: string, tree: Map<string, TreeNode>, groups: Set<string>): string {
  for (let n = tree.get(id); n; n = n.parent_id ? tree.get(n.parent_id) : undefined) {
    if (n.kind === 'folder' && n.param_group_id && groups.has(n.param_group_id)) return n.param_group_id
  }
  return DEFAULT_GROUP
}
/** The item's own exam date, else the nearest ancestor folder's — only while still ahead. */
function examOf(id: string, tree: Map<string, TreeNode>, today: string): string | null {
  for (let n = tree.get(id); n; n = n.parent_id ? tree.get(n.parent_id) : undefined) {
    if (n.exam_date && n.exam_date > today) return n.exam_date
  }
  return null
}

function reviewCountsByGroup(): Map<string, number> {
  const tree = treeMap()
  const groups = new Set(groupRows().map((g) => g.id))
  const counts = new Map<string, number>()
  const rows = getDb().prepare(`SELECT note_id, COUNT(*) AS c FROM review_logs GROUP BY note_id`).all() as { note_id: string; c: number }[]
  for (const r of rows) {
    if (!tree.has(r.note_id)) continue
    const g = groupOf(r.note_id, tree, groups)
    counts.set(g, (counts.get(g) ?? 0) + r.c)
  }
  return counts
}

export function listGroups(): ParamGroup[] {
  const rows = groupRows()
  const counts = reviewCountsByGroup()
  const folders = getDb()
    .prepare(`SELECT id, title, param_group_id FROM notes WHERE kind = 'folder' AND deleted_at IS NULL AND param_group_id IS NOT NULL`)
    .all() as { id: string; title: string; param_group_id: string }[]
  return rows.map((r) => {
    const params = parseParams(r.params)
    const total = counts.get(r.id) ?? 0
    // milestones 100, 200, 400, … : hint when the latest one reached is beyond the last optimization
    let milestone = 0
    for (let m = 100; m <= total; m *= 2) milestone = m
    const hint = milestone > 0 && (params.optimizedAt ?? 0) < milestone ? milestone : null
    return {
      id: r.id,
      name: r.name,
      isDefault: r.is_default === 1,
      params,
      folders: folders.filter((f) => f.param_group_id === r.id).map((f) => ({ id: f.id, title: f.title })),
      totalReviews: total,
      optimizeHint: hint
    }
  })
}

export function createGroup(name: string): ParamGroup[] {
  const base = groupParams(DEFAULT_GROUP)
  getDb()
    .prepare(`INSERT INTO param_groups (id, name, params, is_default, created_at) VALUES (?, ?, ?, 0, ?)`)
    .run(randomUUID(), name.trim() || '新参数组', JSON.stringify({ ...base, optimizedAt: undefined, w: DEFAULT_W }), nowIso())
  return listGroups()
}
export function renameGroup(id: string, name: string): ParamGroup[] {
  getDb().prepare(`UPDATE param_groups SET name = ? WHERE id = ?`).run(name.trim() || '未命名', id)
  return listGroups()
}
/** Delete a group: folders that used it fall back to the default group. */
export function deleteGroup(id: string): ParamGroup[] {
  if (id === DEFAULT_GROUP) return listGroups()
  const d = getDb()
  d.transaction(() => {
    d.prepare(`UPDATE notes SET param_group_id = NULL WHERE param_group_id = ?`).run(id)
    d.prepare(`DELETE FROM param_groups WHERE id = ? AND is_default = 0`).run(id)
  })()
  return listGroups()
}
export function updateGroupParams(id: string, patch: Partial<GroupParams>): ParamGroup[] {
  const cur = groupParams(id)
  getDb().prepare(`UPDATE param_groups SET params = ? WHERE id = ?`).run(JSON.stringify(sanitizeParams({ ...cur, ...patch })), id)
  return listGroups()
}
/** Assign a folder to a group (null = back to inherited / default). */
export function assignFolder(folderId: string, groupId: string | null): ParamGroup[] {
  getDb().prepare(`UPDATE notes SET param_group_id = ? WHERE id = ? AND kind = 'folder'`).run(groupId === DEFAULT_GROUP ? null : groupId, folderId)
  return listGroups()
}

// ---------------------------------------------------------------------------
// Global review preferences
// ---------------------------------------------------------------------------
export interface ReviewPrefs {
  recallFirst: boolean
  recallSeconds: number
  recallShowHighlights: boolean
}
const DEFAULT_PREFS: ReviewPrefs = { recallFirst: true, recallSeconds: 15, recallShowHighlights: false }
export function getReviewPrefs(): ReviewPrefs {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = 'review_prefs'`).get() as { value: string } | undefined
  let p: Partial<ReviewPrefs> = {}
  try {
    p = row ? JSON.parse(row.value) : {}
  } catch {
    /* defaults */
  }
  const secs = Math.round(Number(p.recallSeconds))
  return {
    recallFirst: typeof p.recallFirst === 'boolean' ? p.recallFirst : DEFAULT_PREFS.recallFirst,
    recallSeconds: Number.isFinite(secs) ? Math.min(300, Math.max(5, secs)) : DEFAULT_PREFS.recallSeconds,
    recallShowHighlights: typeof p.recallShowHighlights === 'boolean' ? p.recallShowHighlights : DEFAULT_PREFS.recallShowHighlights
  }
}
export function saveReviewPrefs(patch: Partial<ReviewPrefs>): ReviewPrefs {
  const next = { ...getReviewPrefs(), ...patch }
  getDb().prepare(`INSERT INTO meta (key, value) VALUES ('review_prefs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next))
  return getReviewPrefs()
}

// ---------------------------------------------------------------------------
// Exam dates
// ---------------------------------------------------------------------------
export function setExamDate(id: string, date: string | null): Note | null {
  const v = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  getDb().prepare(`UPDATE notes SET exam_date = ? WHERE id = ?`).run(v, id)
  return getNote(id)
}

// ---------------------------------------------------------------------------
// Reviewing one note
// ---------------------------------------------------------------------------
/** FSRS memory of a note; anything that is not a valid FSRS state (e.g. edited outside the app) counts as not yet learned. */
const memOf = (n: Note): Memory | null =>
  n.state === 'review' && n.stability > 0 && n.difficulty >= 1 && n.difficulty <= 10 ? { stability: n.stability, difficulty: n.difficulty } : null
const lastDay = (n: Note): string | null => (n.last_reviewed_at ? localDay(new Date(n.last_reviewed_at)) : null)
const logCount = (id: string): number => (getDb().prepare(`SELECT COUNT(*) AS c FROM review_logs WHERE note_id = ?`).get(id) as { c: number }).c

function context(note: Note): { p: GroupParams; exam: string | null; today: string; seed: string } {
  const tree = treeMap()
  const groups = new Set(groupRows().map((g) => g.id))
  const today = todayDate()
  return { p: groupParams(groupOf(note.id, tree, groups)), exam: examOf(note.id, tree, today), today, seed: `${note.id}:${logCount(note.id)}` }
}

/** Next interval for each grade (shown under the rating buttons). */
export function previewNote(id: string): Record<Grade, { interval: number; due: string }> | null {
  const note = getNote(id)
  if (!note) return null
  const { p, exam, today, seed } = context(note)
  const mem = memOf(note)
  const last = lastDay(note)
  const elapsed = mem && last ? dayDiff(today, last) : 0
  const out = {} as Record<Grade, { interval: number; due: string }>
  for (const g of [1, 2, 3, 4] as Grade[]) out[g] = schedule(p, nextMemory(p, mem, elapsed, g), g, { today, exam, seed })
  return out
}

/** Append a row to review_logs capturing this single review event. Returns its id. */
function logReview(entry: { note_id: string; rating: Rating; interval_before: number; interval_after: number; state: string; duration_ms: number | null }): string {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO review_logs (id, note_id, reviewed_at, rating, interval_before, interval_after, state, duration_ms)
       VALUES (@id, @note_id, @reviewed_at, @rating, @interval_before, @interval_after, @state, @duration_ms)`
    )
    .run({ id, reviewed_at: nowIso(), ...entry })
  return id
}

/** Record a review and reschedule. Rating: 1=忘了 Again, 2=模糊 Hard, 3=记得 Good, 4=很熟 Easy. */
export function reviewNote(id: string, rating: Rating): Note | null {
  return reviewNoteLogged(id, rating, null)?.note ?? null
}

function reviewNoteLogged(id: string, rating: Rating, durationMs: number | null): { note: Note | null; logId: string } | null {
  const note = getNote(id)
  if (!note) return null
  const { p, exam, today, seed } = context(note)
  const mem = memOf(note)
  const last = lastDay(note)
  const next = nextMemory(p, mem, mem && last ? dayDiff(today, last) : 0, rating)
  const { interval, due } = schedule(p, next, rating, { today, exam, seed })
  const updated = updateNote(id, {
    state: 'review',
    due_date: due,
    last_reviewed_at: nowIso(),
    stability: next.stability,
    difficulty: next.difficulty,
    reps: note.reps + (rating > 1 ? 1 : 0),
    lapses: note.lapses + (rating === 1 && mem ? 1 : 0),
    interval_days: interval
  })
  const logId = logReview({
    note_id: id,
    rating,
    interval_before: note.interval_days,
    interval_after: interval,
    state: 'review',
    duration_ms: durationMs == null ? null : Math.max(0, Math.round(durationMs))
  })
  return { note: updated, logId }
}

/** Grade a note, record the time spent and (optionally) a reflection, atomically. */
export function completeReview(id: string, rating: Rating, reflection: string, durationMs: number | null = null): { note: Note | null; logId: string } | null {
  const d = getDb()
  return d.transaction(() => {
    const res = reviewNoteLogged(id, rating, durationMs)
    if (!res) return null
    const text = reflection.trim()
    if (text) {
      d.prepare(`INSERT INTO review_reflections (id, note_id, review_log_id, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        randomUUID(),
        id,
        res.logId,
        text,
        nowIso()
      )
    }
    return res
  })()
}

// ---------------------------------------------------------------------------
// Daily queue
// ---------------------------------------------------------------------------
export type QueueGroup = 'overdue' | 'due' | 'new'
export interface QueueItem {
  note: Note
  group: QueueGroup
  overdueDays: number
  /** FSRS probability of recall today (null for new items) */
  retrievability: number | null
  paramGroup: string
  estMinutes: number
}
export interface QueueResult {
  items: QueueItem[]
  /** new items beyond the daily new-note limit */
  newHeldBack: number
  /** items cut by the daily review limit / the time target (moved to tomorrow, due dates unchanged) */
  cutByLimit: number
  cutByTime: number
  estMinutes: number
  targetMinutes: number
}

/** Today's review logs, per note (reviews today, first-ever review today, minutes spent). */
function todayActivity(): { reviewed: Set<string>; firstToday: Set<string>; ms: Map<string, number> } {
  const [a, b] = localDayRange(todayDate())
  const rows = getDb()
    .prepare(
      `SELECT l.note_id, l.duration_ms,
              (SELECT MIN(reviewed_at) FROM review_logs f WHERE f.note_id = l.note_id) AS first
       FROM review_logs l WHERE l.reviewed_at >= ? AND l.reviewed_at < ?`
    )
    .all(a, b) as { note_id: string; duration_ms: number | null; first: string }[]
  const reviewed = new Set<string>()
  const firstToday = new Set<string>()
  const ms = new Map<string, number>()
  for (const r of rows) {
    reviewed.add(r.note_id)
    if (r.first >= a && r.first < b) firstToday.add(r.note_id)
    ms.set(r.note_id, (ms.get(r.note_id) ?? 0) + Math.min(r.duration_ms ?? 0, 6 * IDLE_CAP_MS))
  }
  return { reviewed, firstToday, ms }
}

/** Average minutes per review in each group, from the most recent recorded durations. */
function avgMinutes(tree: Map<string, TreeNode>, groups: Set<string>): Map<string, number> {
  const rows = getDb()
    .prepare(`SELECT note_id, duration_ms FROM review_logs WHERE duration_ms IS NOT NULL AND duration_ms > 0 ORDER BY reviewed_at DESC LIMIT 2000`)
    .all() as { note_id: string; duration_ms: number }[]
  const per = new Map<string, number[]>()
  for (const r of rows) {
    const g = groupOf(r.note_id, tree, groups)
    const list = per.get(g) ?? []
    if (list.length < AVG_SAMPLE) list.push(r.duration_ms)
    per.set(g, list)
  }
  const out = new Map<string, number>()
  for (const [g, list] of per) out.set(g, list.reduce((s, x) => s + x, 0) / list.length / 60_000)
  return out
}

export function getReviewQueue(): QueueResult {
  const today = todayDate()
  const tree = treeMap()
  const rows = groupRows()
  const groups = new Set(rows.map((g) => g.id))
  const params = new Map(rows.map((g) => [g.id, parseParams(g.params)]))
  const avg = avgMinutes(tree, groups)
  const act = todayActivity()

  const candidates = getDueNotes(today)
    .filter((n) => n.kind !== 'folder' && ['new', 'review', 'learning'].includes(n.state))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byGroup = new Map<string, Note[]>()
  for (const n of candidates) {
    const g = groupOf(n.id, tree, groups)
    byGroup.set(g, [...(byGroup.get(g) ?? []), n])
  }

  const due: QueueItem[] = []
  const fresh: QueueItem[] = []
  let newHeldBack = 0
  let cutByLimit = 0
  let cutByTime = 0
  let targetMinutes = 0
  for (const [g, notes] of byGroup) {
    const p = params.get(g) ?? sanitizeParams(DEFAULT_PARAMS)
    const per = avg.get(g) ?? DEFAULT_MINUTES_PER_ITEM
    targetMinutes += p.minutesTarget
    const gDue: QueueItem[] = []
    const gNew: QueueItem[] = []
    for (const n of notes) {
      const mem = memOf(n)
      const last = lastDay(n)
      if (!mem) gNew.push({ note: n, group: 'new', overdueDays: 0, retrievability: null, paramGroup: g, estMinutes: per })
      else {
        const overdue = dayDiff(today, n.due_date!)
        gDue.push({
          note: n,
          group: overdue > 0 ? 'overdue' : 'due',
          overdueDays: Math.max(0, overdue),
          retrievability: retrievability(p, mem, last ? dayDiff(today, last) : 0),
          paramGroup: g,
          estMinutes: per
        })
      }
    }
    gDue.sort((a, b) => (a.retrievability ?? 0) - (b.retrievability ?? 0))
    // new items: at most the daily new-note limit (minus those already started today)
    const startedToday = [...act.firstToday].filter((id) => tree.has(id) && groupOf(id, tree, groups) === g).length
    const room = Math.max(0, p.newLimit - startedToday)
    newHeldBack += Math.max(0, gNew.length - room)
    const cand = [...gDue, ...gNew.slice(0, room)]
    // daily review limit and time target (what was already done today counts)
    const doneToday = [...act.reviewed].filter((id) => tree.has(id) && groupOf(id, tree, groups) === g)
    let left = p.reviewLimit - doneToday.length
    let minutesLeft = p.minutesTarget - doneToday.reduce((s, id) => s + (act.ms.get(id) ?? 0), 0) / 60_000
    for (const q of cand) {
      if (left <= 0) {
        cutByLimit++
        continue
      }
      if (q.estMinutes > minutesLeft + 1e-9) {
        cutByTime++
        continue
      }
      left--
      minutesLeft -= q.estMinutes
      ;(q.group === 'new' ? fresh : due).push(q)
    }
  }
  due.sort((a, b) => (a.retrievability ?? 0) - (b.retrievability ?? 0))
  const items = [...due, ...fresh]
  return {
    items,
    newHeldBack,
    cutByLimit,
    cutByTime,
    estMinutes: Math.round(items.reduce((s, q) => s + q.estMinutes, 0)),
    targetMinutes: targetMinutes || DEFAULT_PARAMS.minutesTarget
  }
}

// ---------------------------------------------------------------------------
// History, summary, stats
// ---------------------------------------------------------------------------
export interface ReviewHistoryEntry {
  logId: string
  reviewedAt: string
  rating: Rating
  intervalAfter: number
  reflection: string | null
}

export function getReviewHistory(noteId: string): ReviewHistoryEntry[] {
  return getDb()
    .prepare(
      `SELECT l.id AS logId, l.reviewed_at AS reviewedAt, l.rating AS rating,
              l.interval_after AS intervalAfter, r.content AS reflection
       FROM review_logs l
       LEFT JOIN review_reflections r ON r.review_log_id = l.id
       WHERE l.note_id = ?
       ORDER BY l.reviewed_at DESC, l.rowid DESC`
    )
    .all(noteId) as ReviewHistoryEntry[]
}

export function getReviewSummary(): { reviewedToday: number; reflectionsToday: number; dueTomorrow: number } {
  const d = getDb()
  const today = todayDate()
  const reviewed = d.prepare(`SELECT COUNT(DISTINCT note_id) AS c FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?`).get(...localDayRange(today)) as { c: number }
  const refl = d.prepare(`SELECT COUNT(*) AS c FROM review_reflections WHERE created_at >= ? AND created_at < ?`).get(...localDayRange(today)) as { c: number }
  const tmr = d.prepare(`SELECT COUNT(*) AS c FROM notes WHERE due_date = ? AND deleted_at IS NULL`).get(addDays(today, 1)) as { c: number }
  return { reviewedToday: reviewed.c, reflectionsToday: refl.c, dueTomorrow: tmr.c }
}

export interface ReviewStats {
  id: string
  reps: number
  lapses: number
  totalReviews: number
  again: number
  correctRate: number
  lastReviewedAt: string | null
}
export function getReviewStats(id: string): ReviewStats | null {
  const note = getNote(id)
  if (!note) return null
  const agg = getDb()
    .prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again FROM review_logs WHERE note_id = ?`)
    .get(id) as { total: number; again: number | null }
  const total = agg.total ?? 0
  const again = agg.again ?? 0
  return { id, reps: note.reps, lapses: note.lapses, totalReviews: total, again, correctRate: total > 0 ? (total - again) / total : 1, lastReviewedAt: note.last_reviewed_at }
}

// ---------------------------------------------------------------------------
// 模拟 and 优化参数
// ---------------------------------------------------------------------------
export type SimPattern = 'good' | 'sometimes' | 'easy'
const PATTERNS: Record<SimPattern, Grade[]> = {
  good: [3],
  sometimes: [3, 3, 1, 3, 3, 3, 1, 3], // 偶尔忘了: the 3rd and 7th reviews are 忘了
  easy: [4]
}
export function simulateGroup(groupId: string, pattern: SimPattern, override?: Partial<GroupParams>): ReturnType<typeof simulate> {
  const p = override ? sanitizeParams({ ...groupParams(groupId), ...override }) : groupParams(groupId)
  return simulate(p, PATTERNS[pattern] ?? PATTERNS.good, 8, todayDate())
}

/** Every review of every note in the group, chronological, as (rating, local-day gap). */
function groupHistories(groupId: string): { rating: Grade; delta: number }[][] {
  const tree = treeMap()
  const groups = new Set(groupRows().map((g) => g.id))
  const rows = getDb().prepare(`SELECT note_id, rating, reviewed_at FROM review_logs ORDER BY note_id, reviewed_at ASC, rowid ASC`).all() as {
    note_id: string
    rating: Grade
    reviewed_at: string
  }[]
  const out = new Map<string, { rating: Grade; delta: number }[]>()
  const lastDayOf = new Map<string, string>()
  for (const r of rows) {
    if (!tree.has(r.note_id) || groupOf(r.note_id, tree, groups) !== groupId) continue
    const day = localDay(new Date(r.reviewed_at))
    const prev = lastDayOf.get(r.note_id)
    const list = out.get(r.note_id) ?? []
    list.push({ rating: Math.min(4, Math.max(1, r.rating)) as Grade, delta: prev ? Math.max(0, dayDiff(day, prev)) : 0 })
    out.set(r.note_id, list)
    lastDayOf.set(r.note_id, day)
  }
  return [...out.values()]
}

export interface OptimizeResult {
  ok: boolean
  message: string
  reviews: number
  current: number[]
  optimized: number[] | null
  before: { logLoss: number; rmse: number } | null
  after: { logLoss: number; rmse: number } | null
}

/** Run the FSRS optimizer on the group's review history (nothing is applied here). */
export async function optimizeGroup(groupId: string): Promise<OptimizeResult> {
  const current = groupParams(groupId).w
  const hist = groupHistories(groupId)
  const reviews = hist.reduce((s, h) => s + h.length, 0)
  const empty = { reviews, current, optimized: null, before: null, after: null }
  const b = await import('@open-spaced-repetition/binding')
  // one training item per review after the first: that review with all earlier ones
  const items: InstanceType<typeof b.FSRSBindingItem>[] = []
  for (const h of hist) {
    const reviewsSoFar = h.map((x) => new b.FSRSBindingReview(x.rating, x.delta))
    for (let i = 1; i < reviewsSoFar.length; i++) {
      const item = new b.FSRSBindingItem(reviewsSoFar.slice(0, i + 1))
      if (item.longTermReviewCnt() > 0) items.push(item)
    }
  }
  if (items.length < 8) return { ok: false, message: `复习记录太少(可用于训练的 ${items.length} 条),至少需要几十次跨天复习`, ...empty }
  const evalWith = (w: number[]): { logLoss: number; rmse: number } => {
    const e = new b.FSRSBinding(w).evaluate(items) as unknown as { logLoss?: number; log_loss?: number; rmseBins?: number; rmse_bins?: number }
    return { logLoss: Number(e.logLoss ?? e.log_loss ?? NaN), rmse: Number(e.rmseBins ?? e.rmse_bins ?? NaN) }
  }
  const optimized = (await b.computeParameters(items, { enableShortTerm: false })).map((x) => Math.round(x * 10000) / 10000)
  if (optimized.length !== DEFAULT_W.length) return { ok: false, message: `优化器返回了 ${optimized.length} 个权重,与当前版本不符`, ...empty }
  return { ok: true, message: '已根据复习记录算出新的权重', reviews, current, optimized, before: evalWith(current), after: evalWith(optimized) }
}

export function applyWeights(groupId: string, w: number[] | null): ParamGroup[] {
  const total = reviewCountsByGroup().get(groupId) ?? 0
  return updateGroupParams(groupId, w ? { w, optimizedAt: total } : { w: DEFAULT_W, optimizedAt: undefined })
}

// ---------------------------------------------------------------------------
// One-time migration: replay existing review history into FSRS state
// ---------------------------------------------------------------------------
export interface MigrationReport {
  at: string
  items: number
  replayed: number
  asNew: number
  bigShifts: { id: string; title: string; oldDue: string | null; newDue: string; days: number }[]
}

export function runFsrsReplayIfPending(): MigrationReport | null {
  const d = getDb()
  const flag = d.prepare(`SELECT value FROM meta WHERE key = 'fsrs_replay'`).get() as { value: string } | undefined
  if (flag?.value !== 'pending') return null
  const p = groupParams(DEFAULT_GROUP)
  const today = todayDate()
  const notes = d.prepare(`SELECT * FROM notes WHERE kind != 'folder' AND state != 'library'`).all() as Note[]
  const logs = d.prepare(`SELECT note_id, rating, reviewed_at FROM review_logs ORDER BY reviewed_at ASC, rowid ASC`).all() as {
    note_id: string
    rating: Grade
    reviewed_at: string
  }[]
  const byNote = new Map<string, typeof logs>()
  for (const l of logs) byNote.set(l.note_id, [...(byNote.get(l.note_id) ?? []), l])
  const report: MigrationReport = { at: nowIso(), items: notes.length, replayed: 0, asNew: 0, bigShifts: [] }
  const upd = d.prepare(
    `UPDATE notes SET state = @state, due_date = @due_date, stability = @stability, difficulty = @difficulty,
     reps = @reps, lapses = @lapses, interval_days = @interval_days, last_reviewed_at = @last WHERE id = @id`
  )
  d.transaction(() => {
    for (const n of notes) {
      const h = byNote.get(n.id) ?? []
      if (h.length === 0) {
        // never reviewed: a new item (keeps its due date; a missing one becomes today)
        upd.run({ id: n.id, state: 'new', due_date: n.due_date ?? today, stability: 0, difficulty: 0, reps: 0, lapses: 0, interval_days: 0, last: n.last_reviewed_at })
        report.asNew++
        continue
      }
      let mem: Memory | null = null
      let prev: string | null = null
      let reps = 0
      let lapses = 0
      let sched = { interval: 1, due: today }
      h.forEach((l, i) => {
        const g = Math.min(4, Math.max(1, l.rating)) as Grade
        const day = localDay(new Date(l.reviewed_at))
        if (g === 1 && mem) lapses++
        if (g > 1) reps++
        mem = nextMemory(p, mem, prev ? Math.max(0, dayDiff(day, prev)) : 0, g)
        sched = schedule(p, mem, g, { today: day, exam: null, seed: `${n.id}:${i}` })
        prev = day
      })
      const m = mem as Memory | null
      upd.run({
        id: n.id,
        state: 'review',
        due_date: sched.due,
        stability: m?.stability ?? 0,
        difficulty: m?.difficulty ?? 0,
        reps,
        lapses,
        interval_days: sched.interval,
        last: h[h.length - 1].reviewed_at
      })
      report.replayed++
      if (n.due_date) {
        const shift = dayDiff(sched.due, n.due_date)
        if (Math.abs(shift) > 30) report.bigShifts.push({ id: n.id, title: n.title, oldDue: n.due_date, newDue: sched.due, days: shift })
      }
    }
    d.prepare(`UPDATE meta SET value = 'done' WHERE key = 'fsrs_replay'`).run()
    d.prepare(`INSERT INTO meta (key, value) VALUES ('fsrs_migration_report', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(report))
  })()
  return report
}

export function getMigrationReport(): MigrationReport | null {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = 'fsrs_migration_report'`).get() as { value: string } | undefined
  try {
    return row ? (JSON.parse(row.value) as MigrationReport) : null
  } catch {
    return null
  }
}
