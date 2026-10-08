import { randomUUID } from 'crypto'
import { getDb } from './db'
import { nowIso } from './notes'
import type { AgentStep, ChatSource, ModelRef } from './aiAgent'

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  /** The model this conversation uses; null = the default from settings. */
  model: ModelRef | null
}

export interface StoredMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sources: ChatSource[] | null
  steps: AgentStep[] | null
  created_at: string
}

interface ConvRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  model: string | null
}
interface MsgRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sources_json: string | null
  steps_json: string | null
  created_at: string
}

function parse<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/** Old rows stored sources as [{ noteId, title }]; upgrade them to file sources. */
function normaliseSources(raw: unknown): ChatSource[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw.map((s, i) =>
    s && typeof s === 'object' && 'kind' in s
      ? (s as ChatSource)
      : { kind: 'file', n: i + 1, noteId: (s as { noteId: string }).noteId, title: (s as { title: string }).title, path: '', fileKind: 'file' }
  )
}

const rowToConv = (r: ConvRow): Conversation => ({ ...r, model: parse<ModelRef>(r.model) })

function rowToMessage(r: MsgRow): StoredMessage {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    role: r.role,
    content: r.content,
    sources: normaliseSources(parse(r.sources_json)),
    steps: parse<AgentStep[]>(r.steps_json),
    created_at: r.created_at
  }
}

export function createConversation(title = '', model: ModelRef | null = null): Conversation {
  const now = nowIso()
  const conv: Conversation = { id: randomUUID(), title, created_at: now, updated_at: now, model }
  getDb()
    .prepare(`INSERT INTO conversations (id, title, created_at, updated_at, model) VALUES (@id, @title, @created_at, @updated_at, @model)`)
    .run({ ...conv, model: model ? JSON.stringify(model) : null })
  return conv
}

/** Conversations, most-recently-updated first. */
export function listConversations(): Conversation[] {
  return (getDb().prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all() as ConvRow[]).map(rowToConv)
}

export function renameConversation(id: string, title: string): void {
  getDb()
    .prepare(`UPDATE conversations SET title = @title, updated_at = @updated_at WHERE id = @id`)
    .run({ id, title, updated_at: nowIso() })
}

/** Remember which model a conversation uses (does not bump its recency). */
export function setConversationModel(id: string, model: ModelRef | null): void {
  getDb()
    .prepare(`UPDATE conversations SET model = ? WHERE id = ?`)
    .run(model ? JSON.stringify(model) : null, id)
}

export function touchConversation(id: string): void {
  getDb().prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(nowIso(), id)
}

export function deleteConversation(id: string): void {
  getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
}

export function listMessages(conversationId: string): StoredMessage[] {
  const rows = getDb()
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(conversationId) as MsgRow[]
  return rows.map(rowToMessage)
}

export function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources: ChatSource[] | null,
  steps: AgentStep[] | null = null
): StoredMessage {
  const now = nowIso()
  const msg: StoredMessage = {
    id: randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    sources: sources && sources.length ? sources : null,
    steps: steps && steps.length ? steps : null,
    created_at: now
  }
  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, content, sources_json, steps_json, created_at)
       VALUES (@id, @conversation_id, @role, @content, @sources_json, @steps_json, @created_at)`
    )
    .run({
      ...msg,
      sources_json: msg.sources ? JSON.stringify(msg.sources) : null,
      steps_json: msg.steps ? JSON.stringify(msg.steps) : null
    })
  touchConversation(conversationId)
  return msg
}

/** Remove one message (used by 「重新生成」 to replace the last answer). */
export function deleteMessage(id: string): void {
  getDb().prepare(`DELETE FROM messages WHERE id = ?`).run(id)
}

/** A short title derived from the first user question. */
export function deriveTitle(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim()
  return clean.length > 22 ? clean.slice(0, 22) + '…' : clean || '新对话'
}
