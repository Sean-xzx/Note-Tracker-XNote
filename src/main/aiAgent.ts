import type { WebContents } from 'electron'
import { activeChatProvider, activeWebSearch, getKey, providerConfig, type ProviderId } from './aiConfig'
import { getProvider, type AgentMessage, type ToolCall, type ToolDef } from './aiProviders'
import { libraryItems, libraryManifest, librarySearch, itemText, KIND_LABEL, type ItemKind } from './aiLibrary'
import { getSearchBackend } from './webSearch'
import { getNote } from './notes'

// ---------------------------------------------------------------------------
// Types shared with the renderer (via preload)
// ---------------------------------------------------------------------------
export type ChatSource =
  | { kind: 'file'; n: number; noteId: string; title: string; path: string; fileKind: ItemKind }
  | { kind: 'web'; n: number; url: string; title: string; domain: string }

export type StepTool = 'list_files' | 'search_library' | 'read_file' | 'web_search'
export interface AgentStep {
  tool: StepTool
  label: string
  ok: boolean
}
export interface ModelRef {
  provider: ProviderId
  model: string
}
export interface AgentRequest {
  question: string
  history: { role: 'user' | 'assistant'; content: string }[]
  /** 'all' = whole library; 'current' = focus on the open file. */
  scope: 'all' | 'current'
  currentNoteId: string | null
  web: boolean
  model?: ModelRef | null
}
export type AgentEvent =
  | { type: 'step'; step: AgentStep }
  | { type: 'delta'; delta: string }
  /** Text streamed in a round that turned out to be a tool call — drop it. */
  | { type: 'retract' }
  | { type: 'sources'; sources: ChatSource[] }

const MAX_STEPS = 6
const HISTORY_MAX = 12
const CURRENT_TEXT_MAX = 12000
/** The open file's text sent with every request when the scope is the whole library. */
const CURRENT_BRIEF_MAX = 6000
/** Replies from before the agent existed that claimed no access to files — never replayed. */
const STALE_REFUSAL = /(无法|不能|没法|没有办法|看不到|看不见|读取不到|访问不了)[^。\n]{0,16}(文件|文件库|本地|打开|设备|屏幕)/
const READ_DEFAULT = 6000
const READ_MAX = 12000

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOL_DEFS: Record<StepTool, ToolDef> = {
  list_files: {
    name: 'list_files',
    description: '列出用户 XNote 文件库中的文件和文件夹(含 id、类型、所在位置)。不传 folder 时列出全部;传入文件夹名称或路径时只列出该文件夹里的内容。',
    parameters: {
      type: 'object',
      properties: { folder: { type: 'string', description: '可选:文件夹名称或路径,例如「学习方法」' } }
    }
  },
  search_library: {
    name: 'search_library',
    description: '在整个文件库中检索与问题相关的文件(标题与正文),返回编号、文件 id、位置和命中片段。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '检索词或自然语言问题' } },
      required: ['query']
    }
  },
  read_file: {
    name: 'read_file',
    description: '读取某个文件的文本内容(笔记、PDF、Word、表格、文本都可读)。长文件可用 offset 分段继续读取。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文件 id(来自清单或检索结果);也可以传文件标题' },
        offset: { type: 'integer', description: '从第几个字符开始读,默认 0' },
        length: { type: 'integer', description: `读取的字符数,默认 ${READ_DEFAULT},最多 ${READ_MAX}` }
      },
      required: ['id']
    }
  },
  web_search: {
    name: 'web_search',
    description: '联网搜索网页,获取文件库之外或最新的信息。返回编号、标题、网址和摘要。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索词' } },
      required: ['query']
    }
  }
}

/** Numbered sources in order of first appearance; tools label results with [n]. */
class SourceRegistry {
  private list: ChatSource[] = []
  private keys = new Map<string, number>()
  readFiles = new Set<number>()
  file(noteId: string, title: string, path: string, fileKind: ItemKind): number {
    const k = 'file:' + noteId
    const hit = this.keys.get(k)
    if (hit) return hit
    const n = this.list.length + 1
    this.list.push({ kind: 'file', n, noteId, title, path, fileKind })
    this.keys.set(k, n)
    return n
  }
  web(url: string, title: string): number {
    const k = 'web:' + url
    const hit = this.keys.get(k)
    if (hit) return hit
    const n = this.list.length + 1
    let domain = url
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      /* keep url */
    }
    this.list.push({ kind: 'web', n, url, title, domain })
    this.keys.set(k, n)
    return n
  }
  /** Sources the answer cites ([n]); falls back to the files actually read. */
  cited(answer: string): ChatSource[] {
    const nums = new Set([...answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => +m[1]))
    const cited = this.list.filter((s) => nums.has(s.n))
    if (cited.length) return cited
    return this.list.filter((s) => this.readFiles.has(s.n))
  }
}

interface ToolCtx {
  sender: WebContents | null
  reg: SourceRegistry
  signal: AbortSignal
}

function resolveItem(idOrTitle: string): { id: string; title: string; path: string; kind: ItemKind } | null {
  const items = libraryItems().filter((i) => i.kind !== 'folder')
  const key = idOrTitle.trim().replace(/^《|》$/g, '')
  return (
    items.find((i) => i.id === key) ??
    items.find((i) => i.title === key) ??
    items.find((i) => i.title.toLowerCase().includes(key.toLowerCase()) && key.length >= 2) ??
    null
  )
}

async function runTool(call: ToolCall, ctx: ToolCtx): Promise<{ result: string; step: AgentStep }> {
  let args: Record<string, unknown> = {}
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {}
  } catch {
    /* tolerate malformed JSON: tools have sensible defaults */
  }
  const name = call.name as StepTool
  try {
    if (name === 'list_files') {
      const folder = String(args.folder ?? '').trim()
      const items = libraryItems()
      const inFolder = folder
        ? items.filter((i) => {
            const full = i.path ? `${i.path} / ${i.title}` : i.title
            return i.path.includes(folder) || (i.kind === 'folder' && full.includes(folder))
          })
        : items
      const lines = inFolder
        .slice(0, 300)
        .map((i) => `${i.path ? i.path + ' / ' : ''}${i.title}  〔${KIND_LABEL[i.kind]} · 更新 ${i.updated}${i.kind === 'folder' ? '' : ` · id=${i.id}`}〕`)
      return {
        result: lines.length ? `共 ${inFolder.length} 项:\n${lines.join('\n')}` : folder ? `没有找到文件夹「${folder}」或其中没有内容。` : '文件库是空的。',
        step: { tool: name, label: folder ? `列出了「${folder}」中的文件` : '列出了文件库', ok: true }
      }
    }
    if (name === 'search_library') {
      const query = String(args.query ?? '').trim()
      const hits = await librarySearch(query, ctx.sender, 8)
      const lines = hits.map((h) => {
        const n = ctx.reg.file(h.noteId, h.title, h.path, h.kind)
        return `[${n}] 《${h.title}》(${KIND_LABEL[h.kind]} · 位置:${h.path || '顶层'} · id=${h.noteId})\n片段:${h.snippet}`
      })
      return {
        result: lines.length ? lines.join('\n\n') : `文件库中没有检索到与「${query}」相关的内容。`,
        step: { tool: name, label: `检索文件库「${query.slice(0, 24)}」· ${hits.length} 条结果`, ok: true }
      }
    }
    if (name === 'read_file') {
      const item = resolveItem(String(args.id ?? ''))
      if (!item) return { result: `找不到文件「${String(args.id ?? '')}」。请先用 list_files 或 search_library 获取正确的 id。`, step: { tool: name, label: `读取失败:找不到「${String(args.id ?? '').slice(0, 20)}」`, ok: false } }
      const text = (await itemText(item.id, ctx.sender)) ?? ''
      const offset = Math.max(0, Number(args.offset) || 0)
      const length = Math.min(READ_MAX, Math.max(500, Number(args.length) || READ_DEFAULT))
      const part = text.slice(offset, offset + length)
      const n = ctx.reg.file(item.id, item.title, item.path, item.kind)
      ctx.reg.readFiles.add(n)
      const more = offset + length < text.length ? `\n\n(还有更多内容,可用 offset=${offset + length} 继续读取)` : ''
      return {
        result: text
          ? `[${n}] 《${item.title}》(${KIND_LABEL[item.kind]} · 位置:${item.path || '顶层'}),共 ${text.length} 字,本段 ${offset}–${Math.min(text.length, offset + length)}:\n${part}${more}`
          : `[${n}] 《${item.title}》没有可读取的文本内容(${KIND_LABEL[item.kind]})。`,
        step: { tool: name, label: `读取《${item.title}》`, ok: true }
      }
    }
    if (name === 'web_search') {
      const query = String(args.query ?? '').trim()
      const ws = activeWebSearch()
      if (!ws) return { result: '联网搜索未配置。', step: { tool: name, label: '联网搜索不可用', ok: false } }
      const results = await getSearchBackend(ws.provider, ws.key).search(query, { count: 5, signal: ctx.signal })
      const lines = results.map((r) => {
        const n = ctx.reg.web(r.url, r.title)
        return `[${n}] ${r.title}\n${r.url}\n${r.snippet}`
      })
      return {
        result: lines.length ? lines.join('\n\n') : `没有搜索到与「${query}」相关的网页。`,
        step: { tool: name, label: `联网搜索「${query.slice(0, 24)}」· ${results.length} 个网页`, ok: true }
      }
    }
    return { result: `未知工具 ${call.name}`, step: { tool: 'list_files', label: `未知工具 ${call.name}`, ok: false } }
  } catch (e) {
    return { result: `工具出错:${(e as Error).message}`, step: { tool: name, label: `${call.name} 出错`, ok: false } }
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
async function systemPrompt(req: AgentRequest, web: boolean, sender: WebContents | null, reg: SourceRegistry): Promise<string> {
  const m = libraryManifest()
  // fresh on every request, local time zone ("今天/昨天/本周/多久以前" are relative to this)
  const now = new Date()
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')},${tz}`
  const parts: string[] = [
    '你是 XNote 内置的 AI 助手。XNote 是用户本地的笔记与文件库应用。',
    '你【可以访问】用户的 XNote 文件库:下面给出了完整的文件清单,你还能调用工具列出文件、检索全库、读取任意文件的正文' +
      (web ? '、联网搜索网页' : '') +
      '。绝对不要说「我无法查看你的文件」「我无法访问你的文件库」之类的话。' +
      '如果本对话里较早的回复说过看不到文件或不知道当前打开的文件,那是旧版本的错误说法,一律以本提示中的信息为准。',
    '工作方式:',
    '- 与文件库有关的问题(有哪些文件、文件夹结构、某篇讲了什么、在哪篇里提到过…):先看清单;需要具体内容时用 search_library 检索、用 read_file 读取原文,再作答。',
    web
      ? '- 需要最新信息或文件库之外的资料时,用 web_search 联网搜索。'
      : '- 本次提问没有开启联网搜索;需要最新信息时,请说明这一点并基于已有知识作答。',
    '- 与文件无关的通用问题,直接用你自己的知识回答,不必调用工具。',
    '- 引用资料时,在句末用 [编号] 标注,编号来自工具结果中的 [n];不要编造引用或文件内容。',
    '- 用中文回答,使用 Markdown(标题、列表、表格、代码块;公式用 $...$ 或 $$...$$)。',
    `现在是 ${today}。涉及「今天、昨天、本周、多久以前」等相对时间的问题,一律以此为准。`,
    '',
    `## 文件库清单(共 ${m.total} 项:${m.files} 个文件,${m.folders} 个文件夹)`,
    m.text || '(文件库是空的)'
  ]
  const cur = req.currentNoteId ? getNote(req.currentNoteId) : null
  parts.push('', '## 当前打开的文件')
  if (cur && !cur.deleted_at && cur.kind !== 'folder') {
    const item = libraryItems().find((i) => i.id === cur.id)
    parts.push(`《${cur.title}》(${item ? KIND_LABEL[item.kind] : '文件'} · 位置:${item?.path || '顶层'} · id=${cur.id})`)
    // The open file's text travels with EVERY request (any scope, any provider,
    // with or without tool calling), so "这个文件" never depends on a tool call.
    const cap = req.scope === 'current' ? CURRENT_TEXT_MAX : CURRENT_BRIEF_MAX
    const text = (await itemText(cur.id, sender)) ?? ''
    const n = reg.file(cur.id, cur.title, item?.path ?? '', item?.kind ?? 'file')
    reg.readFiles.add(n)
    parts.push(
      '',
      (req.scope === 'current'
        ? `用户选择了「当前文件」范围:问题默认针对这篇文件(引用编号为 [${n}])。`
        : `用户说「这个文件」「当前文件」「这篇」时,指的就是这篇(引用编号为 [${n}])。`) +
        (text.length > cap
          ? `正文共 ${text.length} 字,以下是前 ${cap} 字,其余部分请用 read_file(id=${cur.id}, offset=${cap}) 分段读取。`
          : '以下是它的完整正文。'),
      '```text',
      text.slice(0, cap) || '(这篇文件没有可读取的文本)',
      '```'
    )
  } else {
    parts.push('(当前没有打开文件)')
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------
function resolveModel(ref: ModelRef | null | undefined): { id: ProviderId; model: string; key: string | null } {
  if (ref && (ref.provider === 'mock' || getKey(ref.provider))) return { id: ref.provider, model: ref.model, key: getKey(ref.provider) }
  const a = activeChatProvider()
  return { id: a.id, model: a.config.chatModel, key: a.key }
}

export async function runAgent(
  req: AgentRequest,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
  sender: WebContents | null,
  requireKey: (id: ProviderId, key: string | null) => void
): Promise<{ content: string; steps: AgentStep[]; sources: ChatSource[]; model: ModelRef }> {
  const { id, model, key } = resolveModel(req.model)
  requireKey(id, key)
  const provider = getProvider(id, key)
  const web = req.web && !!activeWebSearch()
  const reg = new SourceRegistry()
  const steps: AgentStep[] = []
  const ctx: ToolCtx = { sender, reg, signal }
  const tools = (['list_files', 'search_library', 'read_file'] as StepTool[]).concat(web ? ['web_search'] : []).map((t) => TOOL_DEFS[t])
  const system = await systemPrompt(req, web, sender, reg)
  // an old conversation may hold replies from before the agent ("我看不到你的文件");
  // replaying them makes the model repeat itself, so they are left out
  // (dropped together with the question they answered, so turns still alternate)
  const replay: AgentRequest['history'] = []
  for (const h of req.history.slice(-HISTORY_MAX)) {
    if (h.role === 'assistant' && STALE_REFUSAL.test(h.content)) {
      if (replay[replay.length - 1]?.role === 'user') replay.pop()
    } else replay.push(h)
  }
  const history: AgentMessage[] = replay.map((h) => ({ role: h.role, content: h.content }))
  const msgs: AgentMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: req.question }]
  // diagnostics only (env-gated, off in normal use): what is actually sent to the model
  if (process.env.XNOTE_DUMP_PROMPT) {
    try {
      const { appendFileSync } = await import('fs')
      appendFileSync(
        process.env.XNOTE_DUMP_PROMPT,
        JSON.stringify({ at: new Date().toISOString(), provider: id, model: providerConfigModel(id, model), toolCalling: !!provider.chatWithTools, scope: req.scope, currentNoteId: req.currentNoteId, tools: tools.map((t) => t.name), messages: msgs }) + '\n'
      )
    } catch {
      /* ignore */
    }
  }
  const record = (s: AgentStep): void => {
    steps.push(s)
    emit({ type: 'step', step: s })
  }

  let answer = ''
  let toolless = !provider.chatWithTools
  if (provider.chatWithTools) {
    try {
      answer = await toolLoop()
    } catch (e) {
      // a model that rejects tool definitions still gets the manifest + open file
      if (signal.aborted || !/\b(400|404|422)\b/.test(String(e)) || !/tool|function/i.test(String(e))) throw e
      toolless = true
    }
  }
  if (toolless) {
    // Providers / models without function calling: one retrieval pass, then answer.
    const { result, step } = await runTool({ id: 'pre', name: 'search_library', arguments: JSON.stringify({ query: req.question }) }, ctx)
    record(step)
    const system2 = `${system}\n\n## 与问题相关的检索结果\n${result}`
    answer = await provider.chat(
      [{ role: 'system', content: system2 }, ...replay, { role: 'user', content: req.question }],
      { model: providerConfigModel(id, model), signal, onDelta: (d) => emit({ type: 'delta', delta: d }) }
    )
  }
  const sources = reg.cited(answer)
  emit({ type: 'sources', sources })
  return { content: answer, steps, sources, model: { provider: id, model } }

  async function toolLoop(): Promise<string> {
    const chatWithTools = provider.chatWithTools!.bind(provider)
    let final = ''
    for (let round = 0; round <= MAX_STEPS; round++) {
      if (signal.aborted) break
      const last = round === MAX_STEPS
      if (last) msgs.push({ role: 'user', content: '(已达到查阅步数上限。请不要再调用工具,直接基于以上已获取的信息作答。)' })
      let streamed = false
      const r = await chatWithTools(msgs, tools, {
        model: providerConfigModel(id, model),
        signal,
        toolChoice: last ? 'none' : 'auto',
        onDelta: (d) => {
          streamed = true
          emit({ type: 'delta', delta: d })
        }
      })
      if (!r.toolCalls.length || last) {
        final = r.content
        break
      }
      if (streamed) emit({ type: 'retract' })
      msgs.push({ role: 'assistant', content: r.content, tool_calls: r.toolCalls })
      for (const call of r.toolCalls) {
        const { result, step } = await runTool(call, ctx)
        record(step)
        msgs.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }
    return final
  }
}

function providerConfigModel(id: ProviderId, model: string): string {
  return model || providerConfig(id).chatModel
}
