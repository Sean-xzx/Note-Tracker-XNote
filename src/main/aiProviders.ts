import type { ProviderId } from './aiConfig'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export interface ChatOpts {
  model: string
  onDelta: (delta: string) => void
  signal?: AbortSignal
}
// ---- tool calling (agentic Q&A) -------------------------------------------
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}
export interface ToolCall {
  id: string
  name: string
  arguments: string // raw JSON text from the model
}
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export interface ToolChatOpts extends ChatOpts {
  /** 'none' forces a final text answer (used when the step budget is spent). */
  toolChoice?: 'auto' | 'none'
}
export interface ToolChatResult {
  content: string
  toolCalls: ToolCall[]
}

export interface AIProvider {
  chat(messages: ChatMessage[], opts: ChatOpts): Promise<string>
  /** Streaming chat that may request tool calls. Absent → no function calling. */
  chatWithTools?(messages: AgentMessage[], tools: ToolDef[], opts: ToolChatOpts): Promise<ToolChatResult>
  embed(texts: string[], opts: { model: string }): Promise<number[][]>
  test(models: { chatModel: string; embedModel: string }): Promise<{ ok: boolean; message: string }>
  /** Describe / OCR an image (data URL). Present only on vision-capable providers. */
  describeImage?(dataUrl: string, prompt: string, opts: { model: string }): Promise<string>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Read an SSE stream, invoking onData for each `data:` payload (raw string). */
async function readSSE(body: ReadableStream<Uint8Array>, onData: (payload: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) onData(trimmed.slice(5).trim())
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

function parseDataUrl(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  return m ? { mime: m[1], b64: m[2] } : { mime: 'image/png', b64: '' }
}

async function failIfBad(res: Response): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    /* ignore */
  }
  throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenAI itself + any provider that speaks the same
// /chat/completions + /embeddings dialect, e.g. DeepSeek). Only the base URL
// and default models differ, so subclasses just pass a different `baseUrl`.
// ---------------------------------------------------------------------------
class OpenAIProvider implements AIProvider {
  constructor(
    protected key: string,
    protected baseUrl = 'https://api.openai.com/v1'
  ) {}
  protected headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${this.key}`
  })

  async chat(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal: opts.signal
    })
    await failIfBad(res)
    let full = ''
    if (res.body) {
      await readSSE(res.body, (payload) => {
        if (payload === '[DONE]') return
        try {
          const d = JSON.parse(payload)
          const delta = d.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            opts.onDelta(delta)
          }
        } catch {
          /* skip partial */
        }
      })
    }
    return full
  }

  // OpenAI-style function calling, streamed. Tool-call fragments arrive keyed by
  // index (id + name first, then argument text in pieces) and are stitched here.
  async chatWithTools(messages: AgentMessage[], tools: ToolDef[], opts: ToolChatOpts): Promise<ToolChatResult> {
    const wire = messages.map((m) =>
      m.role === 'assistant' && m.tool_calls?.length
        ? {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
          }
        : m
    )
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: opts.model,
        messages: wire,
        stream: true,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({ type: 'function', function: t })),
              tool_choice: opts.toolChoice ?? 'auto'
            }
          : {})
      }),
      signal: opts.signal
    })
    await failIfBad(res)
    let content = ''
    const calls: { id: string; name: string; arguments: string }[] = []
    if (res.body) {
      await readSSE(res.body, (payload) => {
        if (payload === '[DONE]') return
        try {
          const d = JSON.parse(payload)
          const delta = d.choices?.[0]?.delta
          if (delta?.content) {
            content += delta.content
            opts.onDelta(delta.content)
          }
          for (const tc of delta?.tool_calls ?? []) {
            const i = tc.index ?? 0
            calls[i] ??= { id: '', name: '', arguments: '' }
            if (tc.id) calls[i].id = tc.id
            if (tc.function?.name) calls[i].name += tc.function.name
            if (tc.function?.arguments) calls[i].arguments += tc.function.arguments
          }
        } catch {
          /* skip partial */
        }
      })
    }
    return { content, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })) }
  }

  async embed(texts: string[], opts: { model: string }): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: opts.model, input: texts })
    })
    await failIfBad(res)
    const data = (await res.json()) as { data: { embedding: number[] }[] }
    return data.data.map((d) => d.embedding)
  }

  async test(models: { chatModel: string }): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: models.chatModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
    })
    if (res.ok) return { ok: true, message: '连接成功' }
    return { ok: false, message: `连接失败:${res.status} ${res.statusText}` }
  }

  // OpenAI-compatible vision: a single user turn with a text part + an
  // image_url part. Works for OpenAI and DeepSeek (same wire format).
  async describeImage(dataUrl: string, prompt: string, opts: { model: string }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: opts.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        max_tokens: 1024,
        stream: false
      })
    })
    await failIfBad(res)
    const d = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return d.choices?.[0]?.message?.content ?? ''
  }
}

// ---------------------------------------------------------------------------
// DeepSeek — OpenAI-compatible chat API (base https://api.deepseek.com), so it
// reuses OpenAIProvider's chat/streaming logic verbatim. DeepSeek has NO
// embeddings API and NO vision, so embed() throws a clear, actionable error
// (mirroring the Anthropic handling) and indexing must use another provider.
// ---------------------------------------------------------------------------
class DeepSeekProvider extends OpenAIProvider {
  constructor(key: string) {
    super(key, 'https://api.deepseek.com/v1')
  }

  async embed(): Promise<number[][]> {
    throw new Error('DeepSeek 不支持向量索引,请把索引/语义检索的 provider 切换为 OpenAI 或 Google。')
  }

  async test(models: { chatModel: string }): Promise<{ ok: boolean; message: string }> {
    const r = await super.test(models)
    return r.ok ? { ok: true, message: '连接成功(DeepSeek:对话/RAG 可用;索引请用 OpenAI/Google)' } : r
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) — no first-party embeddings API
// ---------------------------------------------------------------------------
class AnthropicProvider implements AIProvider {
  constructor(private key: string) {}
  private headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': this.key,
    'anthropic-version': '2023-06-01'
  })

  async chat(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content
    const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: opts.model, max_tokens: 1024, system, messages: turns, stream: true }),
      signal: opts.signal
    })
    await failIfBad(res)
    let full = ''
    if (res.body) {
      await readSSE(res.body, (payload) => {
        try {
          const d = JSON.parse(payload)
          if (d.type === 'content_block_delta' && d.delta?.text) {
            full += d.delta.text
            opts.onDelta(d.delta.text)
          }
        } catch {
          /* skip */
        }
      })
    }
    return full
  }

  // Anthropic tool use (Messages API): tool_use / tool_result content blocks.
  async chatWithTools(messages: AgentMessage[], tools: ToolDef[], opts: ToolChatOpts): Promise<ToolChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const turns: { role: 'user' | 'assistant'; content: unknown }[] = []
    for (const m of messages) {
      if (m.role === 'system') continue
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }
        const last = turns[turns.length - 1]
        if (last?.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block)
        else turns.push({ role: 'user', content: [block] })
      } else if (m.role === 'assistant' && m.tool_calls?.length) {
        turns.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.tool_calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: safeJson(c.arguments) }))
          ]
        })
      } else turns.push({ role: m.role, content: m.content })
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 4096,
        system,
        messages: turns,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        tool_choice: { type: opts.toolChoice === 'none' ? 'none' : 'auto' }
      }),
      signal: opts.signal
    })
    await failIfBad(res)
    const d = (await res.json()) as { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] }
    let content = ''
    const toolCalls: ToolCall[] = []
    for (const b of d.content ?? []) {
      if (b.type === 'text' && b.text) content += b.text
      if (b.type === 'tool_use') toolCalls.push({ id: b.id ?? `t${toolCalls.length}`, name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) })
    }
    if (content) opts.onDelta(content)
    return { content, toolCalls }
  }

  async embed(): Promise<number[][]> {
    throw new Error('Anthropic 无 embedding API,请把索引用的 provider 切换为 OpenAI 或 Google。')
  }

  async test(models: { chatModel: string }): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: models.chatModel, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    })
    if (res.ok) return { ok: true, message: '连接成功(注:索引需用 OpenAI/Google embedding)' }
    return { ok: false, message: `连接失败:${res.status} ${res.statusText}` }
  }

  async describeImage(dataUrl: string, prompt: string, opts: { model: string }): Promise<string> {
    const { mime, b64 } = parseDataUrl(dataUrl)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }
            ]
          }
        ]
      })
    })
    await failIfBad(res)
    const d = (await res.json()) as { content?: { text?: string }[] }
    return d.content?.map((c) => c.text ?? '').join('') ?? ''
  }
}

// ---------------------------------------------------------------------------
// Google (Gemini)
// ---------------------------------------------------------------------------
class GoogleProvider implements AIProvider {
  constructor(private key: string) {}
  private base = 'https://generativelanguage.googleapis.com/v1beta/models'

  async chat(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const url = `${this.base}/${opts.model}:streamGenerateContent?alt=sse&key=${this.key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined }),
      signal: opts.signal
    })
    await failIfBad(res)
    let full = ''
    if (res.body) {
      await readSSE(res.body, (payload) => {
        try {
          const d = JSON.parse(payload)
          const text = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) {
            full += text
            opts.onDelta(text)
          }
        } catch {
          /* skip */
        }
      })
    }
    return full
  }

  // Gemini function calling: functionCall / functionResponse parts.
  async chatWithTools(messages: AgentMessage[], tools: ToolDef[], opts: ToolChatOpts): Promise<ToolChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const names = new Map<string, string>() // tool_call_id → function name
    const contents: { role: 'user' | 'model'; parts: unknown[] }[] = []
    for (const m of messages) {
      if (m.role === 'system') continue
      if (m.role === 'tool') {
        const part = { functionResponse: { name: names.get(m.tool_call_id) ?? 'tool', response: { content: m.content } } }
        const last = contents[contents.length - 1]
        if (last?.role === 'user' && last.parts.some((p) => (p as { functionResponse?: unknown }).functionResponse)) last.parts.push(part)
        else contents.push({ role: 'user', parts: [part] })
      } else if (m.role === 'assistant') {
        for (const c of m.tool_calls ?? []) names.set(c.id, c.name)
        contents.push({
          role: 'model',
          parts: [...(m.content ? [{ text: m.content }] : []), ...(m.tool_calls ?? []).map((c) => ({ functionCall: { name: c.name, args: safeJson(c.arguments) } }))]
        })
      } else contents.push({ role: 'user', parts: [{ text: m.content }] })
    }
    const res = await fetch(`${this.base}/${opts.model}:generateContent?key=${this.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
        toolConfig: { functionCallingConfig: { mode: opts.toolChoice === 'none' ? 'NONE' : 'AUTO' } }
      }),
      signal: opts.signal
    })
    await failIfBad(res)
    const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] } }[] }
    let content = ''
    const toolCalls: ToolCall[] = []
    for (const p of d.candidates?.[0]?.content?.parts ?? []) {
      if (p.text) content += p.text
      if (p.functionCall) toolCalls.push({ id: `g${Date.now().toString(36)}${toolCalls.length}`, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) })
    }
    if (content) opts.onDelta(content)
    return { content, toolCalls }
  }

  async embed(texts: string[], opts: { model: string }): Promise<number[][]> {
    const url = `${this.base}/${opts.model}:batchEmbedContents?key=${this.key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((t) => ({ model: `models/${opts.model}`, content: { parts: [{ text: t }] } }))
      })
    })
    await failIfBad(res)
    const data = (await res.json()) as { embeddings: { values: number[] }[] }
    return data.embeddings.map((e) => e.values)
  }

  async test(models: { chatModel: string }): Promise<{ ok: boolean; message: string }> {
    const url = `${this.base}/${models.chatModel}:generateContent?key=${this.key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
    })
    if (res.ok) return { ok: true, message: '连接成功' }
    return { ok: false, message: `连接失败:${res.status} ${res.statusText}` }
  }

  async describeImage(dataUrl: string, prompt: string, opts: { model: string }): Promise<string> {
    const { mime, b64 } = parseDataUrl(dataUrl)
    const url = `${this.base}/${opts.model}:generateContent?key=${this.key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }]
      })
    })
    await failIfBad(res)
    const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  }
}

// ---------------------------------------------------------------------------
// Mock — deterministic embeddings + canned streamed answer (for testing the
// full RAG chain without any real key). Real keys are plug-and-play above.
// ---------------------------------------------------------------------------
const MOCK_DIM = 256
function mockEmbedOne(text: string): number[] {
  const v = new Array(MOCK_DIM).fill(0)
  for (const tok of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!tok) continue
    let h = 2166136261
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    v[Math.abs(h) % MOCK_DIM] += 1
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

class MockProvider implements AIProvider {
  async chat(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
    const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const sys = messages.find((m) => m.role === 'system')?.content ?? ''
    const hasContext = /【资料\s*\d+】/.test(sys) || /\[\d+\]/.test(sys)
    const answer = hasContext
      ? `(模拟回答)我已阅读检索到的库内资料并据此作答。关于「${question}」:综合资料 [1] 与 [2] 的内容,可以得到对应的结论。要获得真实答案,请在设置中填入所选 provider 的 API Key。`
      : `(模拟回答)没有在文件库里检索到与「${question}」相关的内容,因此我无法据此回答。`
    for (const piece of answer.match(/.{1,2}/gu) ?? [answer]) {
      if (opts.signal?.aborted) break
      opts.onDelta(piece)
      await sleep(12)
    }
    return answer
  }
  // Deterministic stand-in for a tool-using model, so the whole agent loop and
  // its UI can be exercised without a key or network. Real models decide freely.
  async chatWithTools(messages: AgentMessage[], tools: ToolDef[], opts: ToolChatOpts): Promise<ToolChatResult> {
    const q = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    const results = messages.slice(lastUser).filter((m): m is Extract<AgentMessage, { role: 'tool' }> => m.role === 'tool')
    const called = messages.slice(lastUser).flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : []))
    const has = (n: string): boolean => tools.some((t) => t.name === n)
    const did = (n: string): boolean => called.some((c) => c.name === n)
    const call = (name: string, args: Record<string, unknown>): ToolChatResult => ({
      content: '',
      toolCalls: [{ id: `mock_${called.length}`, name, arguments: JSON.stringify(args) }]
    })
    if (opts.toolChoice !== 'none') {
      const title = /《(.+?)》/.exec(q)?.[1]
      if (/文件夹|结构|有什么文件|哪些文件|文件列表/.test(q) && has('list_files') && !did('list_files')) return call('list_files', {})
      if ((title || /总结|讲了什么|这篇/.test(q)) && has('search_library') && !did('search_library') && !did('read_file'))
        return call('search_library', { query: title ?? q })
      if (did('search_library') && !did('read_file')) {
        const id = /id=([0-9a-f-]{36})/.exec(results[results.length - 1]?.content ?? '')?.[1]
        if (id) return call('read_file', { id })
      }
      if (/联网|最新|新闻|网上/.test(q) && has('web_search') && !did('web_search')) return call('web_search', { query: q })
    }
    const lines = results.map((r) => r.content.split('\n').slice(0, 12).join('\n')).join('\n\n')
    const answer = results.length
      ? `(模拟回答)根据查阅到的资料 [1]:\n\n${lines.slice(0, 900)}`
      : `(模拟回答)关于「${q}」:这是模拟 provider 的直接回答。`
    for (const piece of answer.match(/[\s\S]{1,3}/gu) ?? [answer]) {
      if (opts.signal?.aborted) break
      opts.onDelta(piece)
      await sleep(6)
    }
    return { content: answer, toolCalls: [] }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(mockEmbedOne)
  }
  async test(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: '模拟 provider 已就绪(无需真实 key)' }
  }
  async describeImage(): Promise<string> {
    return '(模拟)这是一张图片,内容无法真实识别,请配置支持视觉的 provider。'
  }
}

/** Build the adapter for a provider + key. */
export function getProvider(id: ProviderId, key: string | null): AIProvider {
  switch (id) {
    case 'openai':
      return new OpenAIProvider(key ?? '')
    case 'deepseek':
      return new DeepSeekProvider(key ?? '')
    case 'anthropic':
      return new AnthropicProvider(key ?? '')
    case 'google':
      return new GoogleProvider(key ?? '')
    default:
      return new MockProvider()
  }
}
