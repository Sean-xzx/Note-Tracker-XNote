import { FSRSAlgorithm, computeDecayFactor, default_w, forgetting_curve } from 'ts-fsrs'

// FSRS scheduling on whole days. ts-fsrs supplies the memory model (stability
// and difficulty after each review); the interval is derived here so the
// app's own rules apply in a fixed order:
//
//   1. interval from stability at the target retention — rounded UP to whole
//      days, at least 1; "忘了" (Again) is always 1 day
//   2. random fuzz (±5%, optional)
//   3. maximum-interval cap
//   4. exam date: never later than two days before it (and never before tomorrow)
//
// No same-day learning steps (short-term scheduling is off). "Today" and the
// gap between reviews are LOCAL calendar days.

export type Grade = 1 | 2 | 3 | 4 // 忘了 Again · 模糊 Hard · 记得 Good · 很熟 Easy

/** Per parameter-group settings. */
export interface GroupParams {
  retention: number
  maxInterval: number
  fuzz: boolean
  reviewLimit: number
  newLimit: number
  minutesTarget: number
  w: number[]
  /** total reviews in the group when the weights were last optimized (for the 100/200/400… hint) */
  optimizedAt?: number
}

export const PARAM_LIMITS = {
  retention: [0.7, 0.97],
  maxInterval: [30, 36500],
  reviewLimit: [1, 500],
  newLimit: [0, 100],
  minutesTarget: [10, 480]
} as const

export const DEFAULT_W: number[] = [...default_w]

export const DEFAULT_PARAMS: GroupParams = {
  retention: 0.9,
  maxInterval: 365,
  fuzz: true,
  reviewLimit: 30,
  newLimit: 5,
  minutesTarget: 90,
  w: DEFAULT_W
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], dflt: number, int = true): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  const c = Math.min(hi, Math.max(lo, n))
  return int ? Math.round(c) : c
}

/** Fill gaps and clamp every value into its allowed range. */
export function sanitizeParams(p: Partial<GroupParams> | null | undefined): GroupParams {
  const w = Array.isArray(p?.w) && p!.w.length === DEFAULT_W.length && p!.w.every((x) => Number.isFinite(Number(x))) ? p!.w.map(Number) : DEFAULT_W
  return {
    retention: Math.round(clamp(p?.retention, PARAM_LIMITS.retention, DEFAULT_PARAMS.retention, false) * 100) / 100,
    maxInterval: clamp(p?.maxInterval, PARAM_LIMITS.maxInterval, DEFAULT_PARAMS.maxInterval),
    fuzz: typeof p?.fuzz === 'boolean' ? p.fuzz : DEFAULT_PARAMS.fuzz,
    reviewLimit: clamp(p?.reviewLimit, PARAM_LIMITS.reviewLimit, DEFAULT_PARAMS.reviewLimit),
    newLimit: clamp(p?.newLimit, PARAM_LIMITS.newLimit, DEFAULT_PARAMS.newLimit),
    minutesTarget: clamp(p?.minutesTarget, PARAM_LIMITS.minutesTarget, DEFAULT_PARAMS.minutesTarget),
    w,
    ...(typeof p?.optimizedAt === 'number' ? { optimizedAt: p.optimizedAt } : {})
  }
}

// ---- memory model ---------------------------------------------------------------
export interface Memory {
  stability: number
  difficulty: number
}

const algCache = new Map<string, FSRSAlgorithm>()
function algorithm(w: number[]): FSRSAlgorithm {
  const key = w.join(',')
  let a = algCache.get(key)
  if (!a) {
    a = new FSRSAlgorithm({ w, enable_short_term: false, enable_fuzz: false, maximum_interval: 36500 })
    algCache.set(key, a)
  }
  return a
}

/** Memory after a review `elapsedDays` after the previous one (null = first review). */
export function nextMemory(p: GroupParams, mem: Memory | null, elapsedDays: number, grade: Grade): Memory {
  const s = algorithm(p.w).next_state(mem, Math.max(0, elapsedDays), grade)
  return { stability: s.stability, difficulty: s.difficulty }
}

/** Probability of recall now, `elapsedDays` after the last review. */
export function retrievability(p: GroupParams, mem: Memory, elapsedDays: number): number {
  if (!(mem.stability > 0)) return 0
  return forgetting_curve(p.w, Math.max(0, elapsedDays), mem.stability)
}

// ---- calendar days (local) ---------------------------------------------------------
const pad = (n: number): string => String(n).padStart(2, '0')
export const localDay = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n))
}
export function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86_400_000)
}

// ---- interval pipeline ------------------------------------------------------------
/** Deterministic in [0,1): the preview shown on a button equals what submitting it applies. */
function unit(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Step 1: whole days from stability at the target retention. */
export function baseInterval(p: GroupParams, stability: number): number {
  const { decay, factor } = computeDecayFactor(p.w)
  const t = (stability / factor) * (Math.pow(p.retention, 1 / decay) - 1)
  return Math.max(1, Math.ceil(t))
}

export interface ScheduleCtx {
  today: string
  /** effective exam date (YYYY-MM-DD) or null */
  exam: string | null
  /** seed for the fuzz (note id + review count) */
  seed: string
}

/** The full pipeline for one grade: interval in days and the due date. */
export function schedule(p: GroupParams, mem: Memory, grade: Grade, ctx: ScheduleCtx): { interval: number; due: string } {
  let d = grade === 1 ? 1 : baseInterval(p, mem.stability)
  if (p.fuzz && grade !== 1 && d >= 3) {
    d = Math.max(1, Math.round(d * (1 + (unit(`${ctx.seed}:${grade}`) * 2 - 1) * 0.05)))
  }
  d = Math.min(d, p.maxInterval)
  let due = addDays(ctx.today, d)
  if (ctx.exam && ctx.exam > ctx.today) {
    const latest = addDays(ctx.exam, -2)
    if (due > latest) {
      const tomorrow = addDays(ctx.today, 1)
      due = latest > tomorrow ? latest : tomorrow
      d = dayDiff(due, ctx.today)
    }
  }
  return { interval: d, due }
}

/** 模拟: the first `n` review dates for a fixed grade pattern, from today. */
export function simulate(p: GroupParams, pattern: Grade[], n = 8, today = localDay()): { date: string; grade: Grade; interval: number }[] {
  const out: { date: string; grade: Grade; interval: number }[] = []
  let mem: Memory | null = null
  let day = today
  let prev: string | null = null
  for (let i = 0; i < n; i++) {
    const g = pattern[i % pattern.length]
    mem = nextMemory(p, mem, prev ? dayDiff(day, prev) : 0, g)
    const { interval, due } = schedule(p, mem, g, { today: day, exam: null, seed: `sim:${i}` })
    out.push({ date: day, grade: g, interval })
    prev = day
    day = due
  }
  return out
}
