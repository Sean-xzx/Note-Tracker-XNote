import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Settings,
  X,
  List,
  Plus,
  Pencil,
  Trash2,
  Search,
  ArrowUp,
  Square,
  Globe,
  ChevronRight,
  ChevronDown,
  Check,
  Copy,
  RotateCcw,
  FileText,
  FolderTree,
  MessagesSquare,
  CircleAlert
} from 'lucide-react'
import type { AgentStep, ChatSource, Conversation, LibraryHit, ModelRef, ProviderId, PublicAiSettings } from '../../../preload'
import { IconButton, EmptyState, Skeleton, Popover, Tooltip, ICON, confirmDialog, promptDialog } from './ui'
import { formatWhen } from '../lib/format'
import { KindGlyph } from '../lib/fileIcon'
import { XMark } from './XMark'
import { ChatMarkdown, copyText } from './ChatMarkdown'

interface Props {
  /** Exit phase of the slide-out (kept mounted while it plays). */
  leaving?: boolean
  width: number
  currentNoteId: string | null
  currentNoteTitle: string | null
  onClose: () => void
  onSelectNote: (id: string) => void
  onOpenSettings: () => void
}

type Tab = 'ask' | 'find'
const TAB_KEY = 'xnote.ai.tab'
const PROVIDER_NAME: Record<ProviderId, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  mock: '本地模拟'
}

export function AiPanel({ leaving, width, currentNoteId, currentNoteTitle, onClose, onSelectNote, onOpenSettings }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) === 'find' ? 'find' : 'ask'))
  const chooseTab = (t: Tab): void => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignore */
    }
  }
  return (
    <aside className={`ai-panel panel-motion${leaving ? ' leaving' : ''}`} style={{ width }}>
      <div className="ai-header">
        <div className="seg sm ai-modes">
          <button className={tab === 'ask' ? 'active' : ''} onClick={() => chooseTab('ask')}>
            提问
          </button>
          <button className={tab === 'find' ? 'active' : ''} onClick={() => chooseTab('find')}>
            查找
          </button>
        </div>
        <div className="ai-header-actions">
          <IconButton icon={Settings} small label="AI 设置" onClick={onOpenSettings} />
          <IconButton icon={X} small label="关闭" onClick={onClose} tooltipPlacement="bottom-end" />
        </div>
      </div>
      {/* both stay mounted so a running answer / typed query survive tab switches */}
      <div className="ai-body" hidden={tab !== 'ask'}>
        <ChatView currentNoteId={currentNoteId} currentNoteTitle={currentNoteTitle} onSelectNote={onSelectNote} onOpenSettings={onOpenSettings} />
      </div>
      <div className="ai-body" hidden={tab !== 'find'}>
        <FindView onSelectNote={onSelectNote} />
      </div>
    </aside>
  )
}

// ===========================================================================
// 查找 — one box; main picks semantic vs keyword
// ===========================================================================
function Highlight({ text, terms }: { text: string; terms: string[] }): JSX.Element {
  const parts = useMemo(() => {
    const ts = terms.filter((t) => t.length > 0).sort((a, b) => b.length - a.length)
    if (!ts.length) return [text]
    const re = new RegExp(`(${ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    return text.split(re)
  }, [text, terms])
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  )
}

function FindView({ onSelectNote }: { onSelectNote: (id: string) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LibraryHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      setBusy(false)
      return
    }
    setBusy(true)
    const my = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await window.api.ai.find(q)
        if (my === seq.current) setHits(r)
      } finally {
        if (my === seq.current) setBusy(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])
  const mode = hits?.[0]?.mode
  return (
    <div className="find-view">
      <label className="tree-search find-box">
        <Search size={ICON.xs} strokeWidth={ICON.stroke} />
        <input autoFocus placeholder="搜索整个文件库" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="find-results">
        {busy && !hits ? (
          <div className="find-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} lines={2} />
            ))}
          </div>
        ) : hits === null ? (
          <EmptyState icon={Search} title="搜索整个文件库" hint="按标题和正文查找;建立向量索引后会自动改用语义检索" />
        ) : hits.length === 0 ? (
          <EmptyState icon={Search} title="没有找到相关文件" hint="换个说法,或检查拼写" />
        ) : (
          <>
            {hits.map((h) => (
              <button key={h.noteId} className="find-row" onClick={() => onSelectNote(h.noteId)}>
                <span className="find-icon">
                  <KindGlyph kind={h.kind} />
                </span>
                <span className="find-main">
                  <span className="find-title">
                    <Highlight text={h.title} terms={h.terms} />
                  </span>
                  {h.path && <span className="find-path">{h.path}</span>}
                  <span className="find-snippet">
                    <Highlight text={h.snippet} terms={h.terms} />
                  </span>
                </span>
              </button>
            ))}
            <div className="find-foot">{mode === 'semantic' ? '语义检索' : '关键词检索'} · {hits.length} 个结果</div>
          </>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// 提问 — agentic chat
// ===========================================================================
interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps: AgentStep[]
  sources: ChatSource[]
  /** assistant: the question it answers (for 重新生成) */
  question?: string
  requestId?: string
  done?: boolean
  error?: boolean
  msgId?: string
}

function deriveTitle(q: string): string {
  const c = q.replace(/\s+/g, ' ').trim()
  return c.length > 22 ? c.slice(0, 22) + '…' : c || '新对话'
}

function StepsLine({ steps, running }: { steps: AgentStep[]; running: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const reads = new Set(steps.filter((s) => s.tool === 'read_file' && s.ok).map((s) => s.label)).size
  const searches = steps.filter((s) => s.tool === 'search_library').length
  const lists = steps.filter((s) => s.tool === 'list_files').length
  const pages = steps.filter((s) => s.tool === 'web_search').reduce((n, s) => n + (+(/(\d+) 个网页/.exec(s.label)?.[1] ?? 0) || 0), 0)
  const parts = [
    lists ? '浏览了文件列表' : '',
    searches ? `检索了 ${searches} 次文件库` : '',
    reads ? `查阅了 ${reads} 个文件` : '',
    pages ? `搜索了 ${pages} 个网页` : ''
  ].filter(Boolean)
  const icon = (s: AgentStep): JSX.Element => {
    const I = s.tool === 'read_file' ? FileText : s.tool === 'list_files' ? FolderTree : s.tool === 'web_search' ? Globe : Search
    return <I size={ICON.xxs} strokeWidth={ICON.stroke} />
  }
  return (
    <div className={`steps${open ? ' open' : ''}`}>
      <button className="steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={ICON.xxs} strokeWidth={ICON.stroke} className="steps-chevron" />
        <span>{running ? `正在查阅 · ${steps[steps.length - 1]?.label ?? ''}` : parts.join(' · ') || '查阅过程'}</span>
      </button>
      {open && (
        <ol className="steps-list">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? '' : 'failed'}>
              {icon(s)}
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SourceCards({ sources, onOpen }: { sources: ChatSource[]; onOpen: (s: ChatSource) => void }): JSX.Element {
  return (
    <div className="source-cards">
      {sources.map((s) => (
        <button key={s.n} className="source-card" onClick={() => onOpen(s)} title={s.kind === 'web' ? s.url : s.path ? `${s.path} / ${s.title}` : s.title}>
          <span className="source-n">{s.n}</span>
          <span className="source-icon">{s.kind === 'web' ? <Globe size={ICON.xs} strokeWidth={ICON.stroke} /> : <KindGlyph kind={s.fileKind} size={ICON.xs} />}</span>
          <span className="source-main">
            <span className="source-title">{s.title}</span>
            <span className="source-sub">{s.kind === 'web' ? s.domain : s.path || '文件库'}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function ChatView({
  currentNoteId,
  currentNoteTitle,
  onSelectNote,
  onOpenSettings
}: {
  currentNoteId: string | null
  currentNoteTitle: string | null
  onSelectNote: (id: string) => void
  onOpenSettings: () => void
}): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [listMax, setListMax] = useState(360)
  const [input, setInput] = useState('')
  const [busyReq, setBusyReq] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [settings, setSettings] = useState<PublicAiSettings | null>(null)
  const [webOn, setWebOn] = useState(true)
  const [pendingModel, setPendingModel] = useState<ModelRef | null>(null)
  const [groups, setGroups] = useState<{ provider: ProviderId; models: string[]; defaultModel: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const turnsRef = useRef<Turn[]>([])
  turnsRef.current = turns
  const accum = useRef(new Map<string, { convId: string; content: string; steps: AgentStep[]; sources: ChatSource[] }>())
  const flushTimer = useRef<number | null>(null)

  const loadConversations = useCallback(() => {
    window.api.chat.list().then(setConversations)
  }, [])
  const loadSettings = useCallback(async () => {
    const [s, g] = await Promise.all([window.api.ai.getSettings(), window.api.ai.chatModels()])
    setSettings(s)
    setGroups(g)
    setWebOn(s.webSearch.enabled)
  }, [])
  useEffect(() => {
    loadConversations()
    loadSettings()
    const onFocus = (): void => void loadSettings()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadConversations, loadSettings])

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null
  const defaultModel: ModelRef | null = settings ? { provider: settings.provider, model: settings.providers[settings.provider].chatModel } : null
  const currentModel = activeConv?.model ?? pendingModel ?? defaultModel
  const webAvailable = !!settings && (settings.webSearch.provider === 'mock' || settings.webSearch.hasKey[settings.webSearch.provider])
  const hasFile = !!currentNoteId
  const effScope = hasFile ? scope : 'all'

  // ---- stream ----
  const flush = useCallback(() => {
    flushTimer.current = null
    setTurns((prev) =>
      prev.map((t) => {
        const a = t.requestId ? accum.current.get(t.requestId) : undefined
        return a ? { ...t, content: a.content, steps: a.steps, sources: a.sources } : t
      })
    )
  }, [])
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current == null) flushTimer.current = window.setTimeout(flush, 40)
  }, [flush])

  useEffect(() => {
    const off = window.api.ai.onStream((e) => {
      const a = accum.current.get(e.requestId)
      if (!a) return
      if (e.type === 'delta') {
        a.content += e.delta
        scheduleFlush()
      } else if (e.type === 'retract') {
        a.content = ''
        scheduleFlush()
      } else if (e.type === 'step') {
        a.steps = [...a.steps, e.step]
        scheduleFlush()
      } else if (e.type === 'sources') {
        a.sources = e.sources
        scheduleFlush()
      } else if (e.type === 'done' || e.type === 'error') {
        if (flushTimer.current != null) {
          clearTimeout(flushTimer.current)
          flushTimer.current = null
        }
        const error = e.type === 'error'
        const content = error ? `出错:${e.message}` : a.content || (e.type === 'done' && e.aborted ? '(已停止)' : '')
        const { convId, steps, sources } = a
        accum.current.delete(e.requestId)
        setBusyReq((r) => (r === e.requestId ? null : r))
        setTurns((prev) => prev.map((t) => (t.requestId === e.requestId ? { ...t, content, steps, sources, done: true, error } : t)))
        window.api.chat.addMessage(convId, 'assistant', content, error ? null : sources, steps).then((m) => {
          setTurns((prev) => prev.map((t) => (t.requestId === e.requestId ? { ...t, msgId: m.id } : t)))
          loadConversations()
        })
      }
    })
    return off
  }, [scheduleFlush, loadConversations])

  // keep pinned to the bottom unless the user scrolled up
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const history = (upTo: number): { role: 'user' | 'assistant'; content: string }[] =>
    turnsRef.current
      .slice(0, upTo)
      .filter((t) => t.role === 'user' || (t.done && !t.error))
      .map((t) => ({ role: t.role, content: t.content }))

  function startAnswer(question: string, convId: string, hist: { role: 'user' | 'assistant'; content: string }[]): void {
    const requestId = crypto.randomUUID()
    accum.current.set(requestId, { convId, content: '', steps: [], sources: [] })
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', steps: [], sources: [], question, requestId }])
    setBusyReq(requestId)
    stickRef.current = true
    window.api.ai
      .ask({
        requestId,
        question,
        history: hist,
        scope: effScope,
        currentNoteId,
        web: webOn && webAvailable,
        model: currentModel
      })
      .catch((err) => {
        accum.current.delete(requestId)
        setBusyReq(null)
        setTurns((prev) => prev.map((t) => (t.requestId === requestId ? { ...t, content: `出错:${(err as Error).message}`, done: true, error: true } : t)))
      })
  }

  async function send(): Promise<void> {
    const q = input.trim()
    if (!q || busyReq) return
    setInput('')
    let convId = activeConvId
    if (!convId) {
      const conv = await window.api.chat.create(deriveTitle(q), currentModel)
      convId = conv.id
      setActiveConvId(conv.id)
      setPendingModel(null)
      setConversations((prev) => [conv, ...prev])
    }
    const hist = history(turnsRef.current.length)
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: q, steps: [], sources: [] }])
    await window.api.chat.addMessage(convId, 'user', q, null)
    startAnswer(q, convId, hist)
    if (settings) setWebOn(settings.webSearch.enabled) // the globe toggle is per question
  }

  async function regenerate(t: Turn): Promise<void> {
    if (busyReq || !activeConvId || !t.question) return
    const idx = turnsRef.current.findIndex((x) => x.id === t.id)
    if (t.msgId) await window.api.chat.deleteMessage(t.msgId)
    setTurns((prev) => prev.filter((x) => x.id !== t.id))
    startAnswer(t.question, activeConvId, history(Math.max(0, idx - 1)))
  }

  async function openConversation(id: string): Promise<void> {
    if (busyReq) return
    setActiveConvId(id)
    setListOpen(false)
    const msgs = await window.api.chat.messages(id)
    let lastQ = ''
    setTurns(
      msgs.map((m) => {
        if (m.role === 'user') lastQ = m.content
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          steps: m.steps ?? [],
          sources: m.sources ?? [],
          done: true,
          error: m.role === 'assistant' && m.content.startsWith('出错:'),
          msgId: m.id,
          question: m.role === 'assistant' ? lastQ : undefined
        }
      })
    )
    stickRef.current = true
  }
  function newConversation(): void {
    if (busyReq) return
    setActiveConvId(null)
    setTurns([])
    setListOpen(false)
    setPendingModel(null)
    taRef.current?.focus()
  }
  async function renameConversation(c: Conversation): Promise<void> {
    const title = await promptDialog({ title: '重命名对话', defaultValue: c.title, confirmLabel: '保存' })
    if (title == null) return
    await window.api.chat.rename(c.id, title.trim() || '新对话')
    loadConversations()
  }
  async function deleteConversation(c: Conversation): Promise<void> {
    if (!(await confirmDialog({ title: '删除对话', message: `删除对话「${c.title}」?此操作不可撤销。`, confirmLabel: '删除', danger: true }))) return
    await window.api.chat.delete(c.id)
    if (activeConvId === c.id) newConversation()
    loadConversations()
  }
  async function chooseModel(ref: ModelRef): Promise<void> {
    if (activeConv) {
      await window.api.chat.setModel(activeConv.id, ref)
      setConversations((prev) => prev.map((c) => (c.id === activeConv.id ? { ...c, model: ref } : c)))
    } else setPendingModel(ref)
  }

  function openSource(s: ChatSource): void {
    if (s.kind === 'web') window.api.app.openExternal(s.url)
    else onSelectNote(s.noteId)
  }

  // textarea: grows with content up to a cap
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
    ta.style.overflowY = ta.scrollHeight > 180 ? 'auto' : 'hidden'
  }, [input])
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')

  return (
    <div className="chat-view">
      <div className="ai-conv-bar">
        <Popover
          placement="bottom-start"
          className="menu conv-pop"
          open={listOpen}
          onOpenChange={(o) => {
            // cards scroll inside the popover: at most ~60% of the panel's height
            if (o) setListMax(Math.round((document.querySelector('.ai-panel')?.clientHeight ?? 600) * 0.6))
            setListOpen(o)
          }}
          trigger={
            <button className={`icon-btn sm${listOpen ? ' active' : ''}`} aria-label="对话列表" title="对话列表" aria-expanded={listOpen}>
              <List size={ICON.sm} strokeWidth={ICON.stroke} />
            </button>
          }
        >
          <div className="conv-pop-inner" style={{ maxHeight: listMax }}>
            <button className="menu-item conv-new" onClick={newConversation} disabled={!!busyReq}>
              <span className="menu-icon">
                <Plus size={ICON.sm} strokeWidth={ICON.stroke} />
              </span>
              新建对话
            </button>
            <div className="conv-pop-list">
              {conversations.length === 0 && <div className="menu-empty">还没有对话。</div>}
              {conversations.map((c) => (
                <div key={c.id} className={`conv-card${activeConvId === c.id ? ' active' : ''}`}>
                  <button className="conv-card-open" onClick={() => openConversation(c.id)} title={c.title || '新对话'}>
                    <span className="conv-card-title">{c.title || '新对话'}</span>
                    <span className="conv-card-time">{formatWhen(c.updated_at)}</span>
                  </button>
                  <div className="conv-card-actions">
                    <IconButton icon={Pencil} small label="重命名" onClick={() => renameConversation(c)} />
                    <IconButton icon={Trash2} small label="删除" onClick={() => deleteConversation(c)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Popover>
        <span className="ai-conv-title" title={activeConv?.title}>
          {activeConv ? activeConv.title : '新对话'}
        </span>
        <IconButton icon={Plus} small label="新建对话" onClick={newConversation} disabled={!!busyReq} tooltipPlacement="bottom-end" />
      </div>

      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {turns.length === 0 ? (
          <div className="chat-empty">
            <EmptyState icon={MessagesSquare} title="问问你的文件库,或任何问题" hint="例如:我有什么文件? · 总结一下某篇文档 · 解释一个概念" />
          </div>
        ) : (
          <div className="chat-thread">
            {turns.map((t) =>
              t.role === 'user' ? (
                <div key={t.id} className="chat-user">
                  <div className="chat-bubble">{t.content}</div>
                </div>
              ) : (
                <div key={t.id} className="chat-assistant">
                  {t.steps.length > 0 && <StepsLine steps={t.steps} running={!t.done && !t.content} />}
                  {!t.done && !t.content && (
                    <div className="ai-thinking" role="status">
                      <XMark state="thinking" size={17} />
                      <span>{t.steps.length ? '正在查阅文件库…' : '正在思考…'}</span>
                    </div>
                  )}
                  {t.content &&
                    (t.error ? (
                      <div className="chat-error">
                        <CircleAlert size={ICON.xs} strokeWidth={ICON.stroke} />
                        <span>{t.content.replace(/^出错:/, '')}</span>
                        {/API Key|设置/.test(t.content) && (
                          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
                            去设置
                          </button>
                        )}
                      </div>
                    ) : (
                      <ChatMarkdown
                        content={t.content}
                        streaming={!t.done}
                        onCite={(n) => {
                          const s = t.sources.find((x) => x.n === n)
                          if (s) openSource(s)
                        }}
                      />
                    ))}
                  {!t.done && t.content && <span className="ai-caret" aria-hidden />}
                  {t.done && t.sources.length > 0 && <SourceCards sources={t.sources} onOpen={openSource} />}
                  {t.done && !t.error && t.content && (
                    <div className="chat-actions">
                      <CopyAction text={t.content} />
                      {t === lastAssistant && <IconButton icon={RotateCcw} small label="重新生成" disabled={!!busyReq} onClick={() => regenerate(t)} />}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="composer">
        {hasFile && (
          <div className={`composer-context${effScope === 'current' ? ' on' : ''}`} title={currentNoteTitle ?? ''}>
            <FileText size={ICON.xxs} strokeWidth={ICON.stroke} />
            <span className="composer-context-label">当前文件:</span>
            <span className="composer-context-title">{currentNoteTitle || '无标题'}</span>
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          className="composer-input"
          placeholder="问问你的文件库,或任何问题…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <ModelPicker groups={groups} current={currentModel} onChoose={chooseModel} onOpen={loadSettings} />
          <div className="seg sm composer-scope">
            <button className={effScope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
              全库
            </button>
            <Tooltip label={hasFile ? '只针对当前打开的文件提问' : '先在左侧打开一个文件'}>
              <button
                className={`${effScope === 'current' ? 'active' : ''}${hasFile ? '' : ' is-disabled'}`}
                aria-disabled={!hasFile}
                onClick={() => hasFile && setScope('current')}
              >
                当前文件
              </button>
            </Tooltip>
          </div>
          <IconButton
            icon={Globe}
            small
            className={webAvailable ? '' : 'is-disabled'}
            aria-disabled={!webAvailable}
            active={webAvailable && webOn}
            label={webAvailable ? (webOn ? '联网搜索:开(可对本次提问关闭)' : '联网搜索:关(仅本次提问)') : '在设置中配置联网搜索'}
            onClick={() => webAvailable && setWebOn((v) => !v)}
          />
          <span className="composer-spacer" />
          {busyReq ? (
            <Tooltip label="停止生成">
              <button className="composer-send stop" aria-label="停止生成" onClick={() => window.api.ai.cancel(busyReq)}>
                <Square size={ICON.xxs} strokeWidth={ICON.stroke} fill="currentColor" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="发送" shortcut="Enter">
              <button className="composer-send" aria-label="发送" disabled={!input.trim()} onClick={() => void send()}>
                <ArrowUp size={ICON.sm} strokeWidth={ICON.stroke} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

function CopyAction({ text }: { text: string }): JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      icon={done ? Check : Copy}
      small
      label={done ? '已复制' : '复制(Markdown)'}
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    />
  )
}

function ModelPicker({
  groups,
  current,
  onChoose,
  onOpen
}: {
  groups: { provider: ProviderId; models: string[]; defaultModel: string }[]
  current: ModelRef | null
  onChoose: (m: ModelRef) => void
  onOpen: () => void
}): JSX.Element {
  return (
    <Popover
      placement="top-start"
      className="menu model-menu"
      onOpenChange={(o) => o && onOpen()}
      trigger={
        <button className="model-trigger" aria-label="选择模型">
          <span className="model-name">{current?.model ?? '未配置模型'}</span>
          <ChevronDown size={ICON.xxs} strokeWidth={ICON.stroke} />
        </button>
      }
    >
      {(close) =>
        groups.length === 0 ? (
          <div className="menu-empty">还没有配置任何 AI 服务,请在设置中填写 API Key。</div>
        ) : (
          groups.map((g) => (
            <div key={g.provider} className="menu-group">
              <div className="menu-group-label">{PROVIDER_NAME[g.provider]}</div>
              {g.models.map((m) => {
                const on = current?.provider === g.provider && current.model === m
                return (
                  <button
                    key={m}
                    className="menu-item"
                    onClick={() => {
                      onChoose({ provider: g.provider, model: m })
                      close()
                    }}
                  >
                    <span className="menu-check">{on && <Check size={ICON.xs} strokeWidth={ICON.stroke} />}</span>
                    <span className="menu-text">
                      <span>{m}</span>
                      {m === g.defaultModel && <span className="menu-hint">默认</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )
      }
    </Popover>
  )
}
