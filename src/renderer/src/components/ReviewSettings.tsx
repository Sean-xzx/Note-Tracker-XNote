import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FolderInput, Pencil, Plus, RotateCcw, Sparkles, Trash2, Folder } from 'lucide-react'
import type { GroupParams, Note, OptimizeResult, ParamGroup, Rating, ReviewPrefs, SimPattern } from '../../../preload'
import { IconButton, Popover, ICON, confirmDialog, promptDialog } from './ui'

// Mirrors the ranges enforced in main/fsrs.ts (the main process clamps again).
const LIMITS = {
  retention: [0.7, 0.97],
  maxInterval: [30, 36500],
  reviewLimit: [1, 500],
  newLimit: [0, 100],
  minutesTarget: [10, 480],
  recallSeconds: [5, 300]
} as const
const GRADE_LABEL: Record<Rating, string> = { 1: '忘了', 2: '模糊', 3: '记得', 4: '很熟' }
const PATTERNS: { id: SimPattern; label: string }[] = [
  { id: 'good', label: '每次记得' },
  { id: 'sometimes', label: '偶尔忘了' },
  { id: 'easy', label: '每次很熟' }
]

/** A number field that commits (clamped) on blur / Enter. */
function NumField({
  id,
  label,
  value,
  unit,
  range,
  step = 1,
  onCommit
}: {
  id: string
  label: string
  value: number
  unit: string
  range: readonly [number, number]
  step?: number
  onCommit: (n: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Number(draft)
    const v = Number.isFinite(n) ? Math.min(range[1], Math.max(range[0], step < 1 ? n : Math.round(n))) : value
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <div className="settings-field settings-inline rs-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={range[0]}
        max={range[1]}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <span className="settings-unit">
        {unit} <span className="rs-range">({range[0]}–{range[1]})</span>
      </span>
    </div>
  )
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  const w = '日一二三四五六'[new Date(y, m - 1, day).getDay()]
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 周${w}`
}

/** Settings → 复习: 基本 · 复习方式 · 参数组 · 高级 · 模拟. */
export function ReviewSettings(): JSX.Element {
  const [groups, setGroups] = useState<ParamGroup[]>([])
  const [gid, setGid] = useState('default')
  const [prefs, setPrefs] = useState<ReviewPrefs | null>(null)
  const [folders, setFolders] = useState<Note[]>([])
  const [pattern, setPattern] = useState<SimPattern>('good')
  const [sim, setSim] = useState<{ date: string; grade: Rating; interval: number }[]>([])
  const [opt, setOpt] = useState<OptimizeResult | null>(null)
  const [optBusy, setOptBusy] = useState(false)

  const reload = useCallback(async () => {
    const [g, p, t] = await Promise.all([window.api.review.groups(), window.api.review.prefs(), window.api.tree.list()])
    setGroups(g)
    setPrefs(p)
    setFolders(t.filter((n) => n.kind === 'folder'))
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const group = groups.find((g) => g.id === gid) ?? groups[0]
  const p = group?.params
  useEffect(() => {
    if (group) window.api.review.simulate(group.id, pattern).then(setSim)
  }, [group?.id, pattern, p?.retention, p?.maxInterval, p?.fuzz, p?.w.join(',')])

  if (!group || !p || !prefs) return <section className="settings-section"><h3>复习</h3></section>

  const update = async (patch: Partial<GroupParams>): Promise<void> => setGroups(await window.api.review.updateGroup(group.id, patch))
  const savePrefs = async (patch: Partial<ReviewPrefs>): Promise<void> => setPrefs(await window.api.review.savePrefs(patch))
  const groupName = (id: string | null | undefined): string => groups.find((g) => g.id === id)?.name ?? '笔记'

  async function newGroup(): Promise<void> {
    const name = await promptDialog({ title: '新建参数组', defaultValue: '考试资料', confirmLabel: '创建' })
    if (name == null) return
    const next = await window.api.review.createGroup(name)
    setGroups(next)
    setGid(next[next.length - 1].id)
  }
  async function rename(g: ParamGroup): Promise<void> {
    const name = await promptDialog({ title: '重命名参数组', defaultValue: g.name, confirmLabel: '保存' })
    if (name != null) setGroups(await window.api.review.renameGroup(g.id, name))
  }
  async function remove(g: ParamGroup): Promise<void> {
    const ok = await confirmDialog({
      title: '删除参数组',
      message: `删除「${g.name}」?${g.folders.length ? `使用它的 ${g.folders.length} 个文件夹会回到默认组「笔记」。` : ''}`,
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
    setGroups(await window.api.review.deleteGroup(g.id))
    if (gid === g.id) setGid('default')
  }
  async function toggleFolder(g: ParamGroup, f: Note): Promise<void> {
    const on = f.param_group_id === g.id
    setGroups(await window.api.review.assignFolder(f.id, on ? null : g.id))
    setFolders((await window.api.tree.list()).filter((n) => n.kind === 'folder'))
  }
  async function optimize(): Promise<void> {
    setOptBusy(true)
    setOpt(null)
    try {
      setOpt(await window.api.review.optimize(group.id))
    } catch (e) {
      setOpt({ ok: false, message: `优化失败:${(e as Error).message}`, reviews: group.totalReviews, current: p!.w, optimized: null, before: null, after: null })
    } finally {
      setOptBusy(false)
    }
  }

  return (
    <section className="settings-section review-settings">
      <h3>复习</h3>

      {/* ---- 基本 ---- */}
      <div className="rs-block">
        <div className="rs-block-head">
          <h4>基本</h4>
          <div className="rs-group-pick">
            <span className="settings-unit">参数组</span>
            <Popover
              placement="bottom-end"
              className="menu select-menu"
              trigger={
                <button className="select-trigger" aria-label="选择参数组">
                  <span className="select-value">{group.name}</span>
                  <ChevronDown size={ICON.xs} strokeWidth={ICON.stroke} />
                </button>
              }
            >
              {(close) =>
                groups.map((g) => (
                  <button
                    key={g.id}
                    className="menu-item"
                    onClick={() => {
                      setGid(g.id)
                      setOpt(null)
                      close()
                    }}
                  >
                    <span className="menu-check">{g.id === group.id && <Check size={ICON.xs} strokeWidth={ICON.stroke} />}</span>
                    <span className="menu-text">{g.name}</span>
                  </button>
                ))
              }
            </Popover>
          </div>
        </div>
        <div className="settings-field rs-row rs-retention">
          <label htmlFor="rs-ret">目标记忆率</label>
          <div className="rs-slider">
            <input
              id="rs-ret"
              type="range"
              min={LIMITS.retention[0]}
              max={LIMITS.retention[1]}
              step={0.01}
              value={p.retention}
              onChange={(e) => setGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, params: { ...g.params, retention: Number(e.target.value) } } : g)))}
              onPointerUp={(e) => update({ retention: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => update({ retention: Number((e.target as HTMLInputElement).value) })}
            />
            <b className="rs-ret-value">{p.retention.toFixed(2)}</b>
          </div>
          <span className="settings-field-hint">越高复习越频繁</span>
        </div>
        <NumField id="rs-max" label="最长间隔" value={p.maxInterval} unit="天" range={LIMITS.maxInterval} onCommit={(n) => update({ maxInterval: n })} />
        <NumField id="rs-min" label="每日复习时长目标" value={p.minutesTarget} unit="分钟" range={LIMITS.minutesTarget} onCommit={(n) => update({ minutesTarget: n })} />
        <NumField id="rs-lim" label="每日复习上限" value={p.reviewLimit} unit="篇" range={LIMITS.reviewLimit} onCommit={(n) => update({ reviewLimit: n })} />
        <NumField id="rs-new" label="每日新笔记上限" value={p.newLimit} unit="篇" range={LIMITS.newLimit} onCommit={(n) => update({ newLimit: n })} />
        <label className="check-row rs-row">
          <input type="checkbox" className="check" checked={p.fuzz} onChange={(e) => update({ fuzz: e.target.checked })} />
          间隔随机浮动(±5%,避免同一天到期的内容扎堆)
        </label>
      </div>

      {/* ---- 复习方式 ---- */}
      <div className="rs-block">
        <h4>复习方式</h4>
        <label className="check-row rs-row">
          <input type="checkbox" className="check" checked={prefs.recallFirst} onChange={(e) => savePrefs({ recallFirst: e.target.checked })} />
          先回想再看(打开笔记时先只显示标题)
        </label>
        <NumField id="rs-recall" label="回想时长提示" value={prefs.recallSeconds} unit="秒" range={LIMITS.recallSeconds} onCommit={(n) => savePrefs({ recallSeconds: n })} />
        <label className="check-row rs-row">
          <input type="checkbox" className="check" checked={prefs.recallShowHighlights} disabled={!prefs.recallFirst} onChange={(e) => savePrefs({ recallShowHighlights: e.target.checked })} />
          回想阶段显示已划的重点
        </label>
      </div>

      {/* ---- 参数组 ---- */}
      <div className="rs-block">
        <div className="rs-block-head">
          <h4>参数组</h4>
          <button className="btn btn-secondary btn-sm" onClick={newGroup}>
            <Plus size={ICON.sm} strokeWidth={ICON.stroke} />
            新建参数组
          </button>
        </div>
        <p className="settings-hint">默认组「笔记」用于所有条目。把参数组指定给文件夹后,该文件夹及其子文件夹里的条目使用这个组。</p>
        <ul className="rs-groups">
          {groups.map((g) => (
            <li key={g.id} className={`rs-group${g.id === group.id ? ' active' : ''}`}>
              <button className="rs-group-main" onClick={() => setGid(g.id)}>
                <span className="rs-group-name">
                  {g.name}
                  {g.isDefault && <span className="rs-badge">默认</span>}
                </span>
                <span className="rs-group-meta">
                  {g.isDefault ? '未指定参数组的全部条目' : g.folders.length ? g.folders.map((f) => f.title).join('、') : '还没有指定文件夹'} · 已复习 {g.totalReviews} 次
                </span>
              </button>
              <div className="rs-group-actions">
                {!g.isDefault && (
                  <Popover
                    placement="bottom-end"
                    className="menu rs-folder-menu"
                    trigger={
                      <button className="icon-btn sm" aria-label="指定文件夹" title="指定文件夹">
                        <FolderInput size={ICON.sm} strokeWidth={ICON.stroke} />
                      </button>
                    }
                  >
                    <div className="menu-group-label">指定给文件夹</div>
                    {folders.length === 0 && <div className="menu-empty">还没有文件夹</div>}
                    {folders.map((f) => {
                      const other = f.param_group_id && f.param_group_id !== g.id ? groupName(f.param_group_id) : null
                      return (
                        <button key={f.id} className="menu-item" onClick={() => toggleFolder(g, f)}>
                          <span className="menu-check">{f.param_group_id === g.id && <Check size={ICON.xs} strokeWidth={ICON.stroke} />}</span>
                          <span className="menu-icon">
                            <Folder size={ICON.sm} strokeWidth={ICON.stroke} />
                          </span>
                          <span className="menu-text">
                            <span>{f.title}</span>
                            {other && <span className="menu-hint">当前:{other}</span>}
                          </span>
                        </button>
                      )
                    })}
                  </Popover>
                )}
                <IconButton icon={Pencil} small label="重命名" onClick={() => rename(g)} />
                {!g.isDefault && <IconButton icon={Trash2} small label="删除" onClick={() => remove(g)} />}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- 高级 ---- */}
      <details className="rs-block rs-advanced">
        <summary>
          <ChevronRight size={ICON.sm} strokeWidth={ICON.stroke} />
          <h4>高级</h4>
          <span className="settings-unit">FSRS 权重 · 「{group.name}」</span>
        </summary>
        {group.optimizeHint && (
          <div className="rs-hint">
            <Sparkles size={ICON.sm} strokeWidth={ICON.stroke} />
            这个参数组已累计 {group.totalReviews} 次复习(达到 {group.optimizeHint} 次),可以用自己的记录优化参数。
          </div>
        )}
        <div className="rs-weights">
          {p.w.map((w, i) => (
            <label key={i} className="rs-w">
              <span>w{i}</span>
              <input
                type="number"
                step={0.0001}
                defaultValue={w}
                key={`${group.id}:${i}:${w}`}
                onBlur={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n) || n === w) return
                  update({ w: p.w.map((x, j) => (j === i ? n : x)) })
                }}
              />
            </label>
          ))}
        </div>
        <div className="rs-actions">
          <button className="btn btn-secondary btn-sm" onClick={optimize} disabled={optBusy}>
            <Sparkles size={ICON.sm} strokeWidth={ICON.stroke} />
            {optBusy ? '正在优化…' : '优化参数'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              if (await confirmDialog({ title: '恢复默认权重', message: `把「${group.name}」的 FSRS 权重恢复为 ts-fsrs 的默认值?`, confirmLabel: '恢复' }))
                setGroups(await window.api.review.applyWeights(group.id, null))
            }}
          >
            <RotateCcw size={ICON.sm} strokeWidth={ICON.stroke} />
            恢复默认
          </button>
          <span className="settings-unit">用该组 {group.totalReviews} 次复习记录训练</span>
        </div>
        {opt && (
          <div className={`rs-opt${opt.ok ? '' : ' fail'}`}>
            <div className="rs-opt-msg">{opt.message}</div>
            {opt.ok && opt.optimized && opt.before && opt.after && (
              <>
                <table className="rs-table">
                  <thead>
                    <tr>
                      <th />
                      <th>对数损失 ↓</th>
                      <th>RMSE ↓</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>当前权重</td>
                      <td>{opt.before.logLoss.toFixed(4)}</td>
                      <td>{opt.before.rmse.toFixed(4)}</td>
                    </tr>
                    <tr>
                      <td>优化后</td>
                      <td>{opt.after.logLoss.toFixed(4)}</td>
                      <td>{opt.after.rmse.toFixed(4)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="rs-wdiff">
                  {opt.optimized.map((w, i) => (
                    <span key={i} className={Math.abs(w - opt.current[i]) > 1e-4 ? 'changed' : ''}>
                      w{i} {opt.current[i].toFixed(3)} → {w.toFixed(3)}
                    </span>
                  ))}
                </div>
                <div className="rs-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      setGroups(await window.api.review.applyWeights(group.id, opt.optimized))
                      setOpt(null)
                    }}
                  >
                    应用优化后的权重
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOpt(null)}>
                    不应用
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </details>

      {/* ---- 模拟 ---- */}
      <div className="rs-block">
        <div className="rs-block-head">
          <h4>模拟</h4>
          <div className="seg sm" role="tablist" aria-label="评分序列">
            {PATTERNS.map((x) => (
              <button key={x.id} className={pattern === x.id ? 'active' : ''} onClick={() => setPattern(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-hint">按「{group.name}」当前的参数,从今天第一次复习开始,列出前 8 次复习的日期。</p>
        <table className="rs-table rs-sim">
          <thead>
            <tr>
              <th>第几次</th>
              <th>日期</th>
              <th>评分</th>
              <th>下次间隔</th>
            </tr>
          </thead>
          <tbody>
            {sim.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{fmtDate(r.date)}</td>
                <td className={r.grade === 1 ? 'forgot' : ''}>{GRADE_LABEL[r.grade]}</td>
                <td>{r.interval} 天</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
