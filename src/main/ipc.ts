import { ipcMain, shell } from 'electron'
import {
  createNote,
  createFolder,
  getNote,
  listNotes,
  getDueNotes,
  updateNote,
  deleteNote,
  saveNoteContent,
  getNoteContent,
  createFileItem,
  createImageAsset,
  uploadFileItems,
  getFileBytes,
  saveFileText,
  pickAndReplaceFile,
  openFileInSystem,
  addToReview,
  renameItem,
  moveItem,
  listTree,
  softDelete,
  restore,
  listTrash,
  permanentlyDelete,
  emptyTrash,
  type NoteUpdate
} from './notes'
import {
  reviewNote,
  getReviewStats,
  getReviewQueue,
  completeReview,
  getReviewHistory,
  getReviewSummary,
  previewNote,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  updateGroupParams,
  assignFolder,
  getReviewPrefs,
  saveReviewPrefs,
  setExamDate,
  simulateGroup,
  optimizeGroup,
  applyWeights,
  getMigrationReport,
  type Rating,
  type ReviewPrefs,
  type SimPattern
} from './review'
import type { GroupParams } from './fsrs'
import { aiSearch } from './ai'
import {
  getPublicSettings,
  saveSettings,
  setKey,
  getKey,
  activeChatProvider,
  ALL_PROVIDERS,
  type ProviderId,
  type ProviderConfig,
  type SearchProviderId,
  type WebSearchSettings
} from './aiConfig'
import { getProvider } from './aiProviders'
import { runAgent, type AgentRequest, type AgentStep, type ChatSource, type ModelRef } from './aiAgent'
import { librarySearch, resolveExtract } from './aiLibrary'
import { refreshModels, verifyVision } from './aiModels'
import { testWebSearch } from './webSearch'

const PROVIDER_NAME: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek' }
/** Readable Chinese message for the common transport failures (instead of "fetch failed"). */
function friendlyAiError(err: unknown): string {
  const e = err as Error & { cause?: { code?: string } }
  const text = `${e?.message ?? ''} ${e?.cause?.code ?? ''}`
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(text))
    return '网络连接失败,请检查网络或代理设置后重试。'
  if (e?.name === 'AbortError') return '已取消。'
  return e?.message || String(err)
}

/** Clear message instead of a raw 401 when a real provider has no key yet. */
function requireKey(id: string, key: string | null): void {
  if (id !== 'mock' && !key) throw new Error(`尚未配置 ${PROVIDER_NAME[id] ?? id} 的 API Key,请到「设置」中填写后再试。`)
}
import {
  indexPlan,
  indexNote,
  clearIndex,
  indexStatus,
  semanticSearch,
  type PlanItem
} from './aiIndex'
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  listMessages,
  addMessage,
  deleteMessage,
  setConversationModel
} from './aiChat'
import {
  addAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation,
  restoreAnnotation,
  updateAnchors,
  type Annotation,
  listAllAnnotations,
  listAnnotationsByDate,
  type NewAnnotation,
  type AnnoAnchor,
  type AnnoType
} from './annotations'

/**
 * Wire the library/notes API into IPC channels. Called once from the main
 * process after the app is ready. The renderer calls these via window.api.*.
 */
export function registerIpcHandlers(): void {
  // Notes / library items.
  ipcMain.handle(
    'notes:create',
    (_e, title: string, parentId: string | null = null) =>
      createNote(title, [], parentId)
  )
  ipcMain.handle('folders:create', (_e, name: string, parentId: string | null = null) =>
    createFolder(name, parentId)
  )
  ipcMain.handle('notes:get', (_e, id: string) => getNote(id))
  ipcMain.handle('notes:list', () => listNotes())
  ipcMain.handle('notes:update', (_e, id: string, fields: NoteUpdate) =>
    updateNote(id, fields)
  )
  ipcMain.handle('notes:delete', (_e, id: string) => deleteNote(id))
  ipcMain.handle('notes:saveContent', (_e, id: string, content: string) =>
    saveNoteContent(id, content)
  )
  ipcMain.handle('notes:getContent', (_e, id: string) => getNoteContent(id))

  // Review queue + spaced-repetition scheduling.
  ipcMain.handle('notes:getDue', (_e, date?: string) => getDueNotes(date))
  ipcMain.handle('notes:addToReview', (_e, id: string) => addToReview(id))
  ipcMain.handle('review:review', (_e, id: string, rating: Rating) =>
    reviewNote(id, rating)
  )
  ipcMain.handle('review:stats', (_e, id: string) => getReviewStats(id))
  ipcMain.handle('review:queue', () => getReviewQueue())
  ipcMain.handle('review:complete', (_e, id: string, rating: Rating, reflection: string, durationMs?: number) =>
    completeReview(id, rating, reflection, typeof durationMs === 'number' ? durationMs : null)
  )
  ipcMain.handle('review:preview', (_e, id: string) => previewNote(id))
  ipcMain.handle('review:groups', () => listGroups())
  ipcMain.handle('review:createGroup', (_e, name: string) => createGroup(name))
  ipcMain.handle('review:renameGroup', (_e, id: string, name: string) => renameGroup(id, name))
  ipcMain.handle('review:deleteGroup', (_e, id: string) => deleteGroup(id))
  ipcMain.handle('review:updateGroup', (_e, id: string, patch: Partial<GroupParams>) => updateGroupParams(id, patch))
  ipcMain.handle('review:assignFolder', (_e, folderId: string, groupId: string | null) => assignFolder(folderId, groupId))
  ipcMain.handle('review:prefs', () => getReviewPrefs())
  ipcMain.handle('review:savePrefs', (_e, patch: Partial<ReviewPrefs>) => saveReviewPrefs(patch))
  ipcMain.handle('review:simulate', (_e, groupId: string, pattern: SimPattern) => simulateGroup(groupId, pattern))
  ipcMain.handle('review:optimize', (_e, groupId: string) => optimizeGroup(groupId))
  ipcMain.handle('review:applyWeights', (_e, groupId: string, w: number[] | null) => applyWeights(groupId, w))
  ipcMain.handle('review:migrationReport', () => getMigrationReport())
  ipcMain.handle('notes:setExamDate', (_e, id: string, date: string | null) => setExamDate(id, date))
  ipcMain.handle('review:history', (_e, noteId: string) => getReviewHistory(noteId))
  ipcMain.handle('review:summary', () => getReviewSummary())

  // File library: upload, add-by-path (drag/drop), read bytes, open in system.
  ipcMain.handle('files:upload', (_e, parentId: string | null = null) =>
    uploadFileItems(parentId)
  )
  ipcMain.handle('files:add', (_e, filePath: string, parentId: string | null = null) =>
    createFileItem(filePath, parentId)
  )
  ipcMain.handle('files:getBytes', (_e, id: string) => getFileBytes(id))
  ipcMain.handle('files:addImage', (_e, noteId: string, name: string, bytes: Uint8Array) => createImageAsset(noteId, name, bytes))
  ipcMain.handle('files:saveText', (_e, id: string, content: string) =>
    saveFileText(id, content)
  )
  ipcMain.handle('files:replace', (_e, id: string) => pickAndReplaceFile(id))
  ipcMain.handle('files:open', (_e, id: string) => openFileInSystem(id))

  // File tree + recycle bin.
  ipcMain.handle('tree:list', () => listTree())
  ipcMain.handle('tree:rename', (_e, id: string, title: string) =>
    renameItem(id, title)
  )
  ipcMain.handle(
    'tree:move',
    (_e, id: string, newParentId: string | null, newSortOrder: number) =>
      moveItem(id, newParentId, newSortOrder)
  )
  ipcMain.handle('tree:softDelete', (_e, id: string) => softDelete(id))
  ipcMain.handle('tree:restore', (_e, id: string) => restore(id))
  ipcMain.handle('tree:listTrash', () => listTrash())
  ipcMain.handle('tree:permanentlyDelete', (_e, id: string) => permanentlyDelete(id))
  ipcMain.handle('tree:emptyTrash', () => emptyTrash())

  // Annotations (highlights / underlines / comments / rects).
  ipcMain.handle('anno:add', (_e, noteId: string, data: NewAnnotation) =>
    addAnnotation(noteId, data)
  )
  ipcMain.handle('anno:list', (_e, noteId: string) => listAnnotations(noteId))
  ipcMain.handle(
    'anno:update',
    (_e, id: string, fields: { color?: string; note_text?: string | null; type?: AnnoType }) =>
      updateAnnotation(id, fields)
  )
  ipcMain.handle('anno:delete', (_e, id: string) => deleteAnnotation(id))
  ipcMain.handle('anno:restore', (_e, a: Annotation) => restoreAnnotation(a))
  ipcMain.handle('anno:updateAnchors', (_e, items: { id: string; anchor: AnnoAnchor; quote: string }[]) => updateAnchors(items))
  ipcMain.handle('anno:listAll', () => listAllAnnotations())
  ipcMain.handle('anno:byDate', (_e, from?: string, to?: string) =>
    listAnnotationsByDate(from, to)
  )

  // AI keyword search (fallback / non-semantic mode).
  ipcMain.handle('ai:search', (_e, query: string) => aiSearch(query))

  // ---- AI: settings ----
  ipcMain.handle('ai:getSettings', () => getPublicSettings())
  ipcMain.handle(
    'ai:saveSettings',
    (
      _e,
      update: {
        provider?: ProviderId
        embedProvider?: ProviderId
        providers?: Partial<Record<ProviderId, ProviderConfig>>
        webSearch?: Partial<WebSearchSettings>
      }
    ) => saveSettings(update)
  )
  ipcMain.handle('ai:setKey', (_e, provider: ProviderId | SearchProviderId, key: string) => {
    setKey(provider, key)
    return getPublicSettings()
  })
  ipcMain.handle('ai:test', async (_e, provider: ProviderId) => {
    const s = getPublicSettings()
    const cfg = s.providers[provider]
    try {
      requireKey(provider, getKey(provider))
      return await getProvider(provider, getKey(provider)).test({ chatModel: cfg.chatModel, embedModel: cfg.embedModel })
    } catch (err) {
      return { ok: false, message: friendlyAiError(err) }
    }
  })

  // ---- AI: indexing ----
  ipcMain.handle('ai:indexPlan', (_e, items: PlanItem[]) => indexPlan(items))
  ipcMain.handle('ai:indexNote', async (_e, noteId: string, text: string) => {
    try {
      return await indexNote(noteId, text)
    } catch (err) {
      return { status: 'error' as const, error: (err as Error).message }
    }
  })
  ipcMain.handle('ai:clearIndex', (_e, noteId?: string) => {
    clearIndex(noteId)
    return indexStatus()
  })
  ipcMain.handle('ai:indexStatus', () => indexStatus())

  // ---- AI: semantic search ----
  ipcMain.handle('ai:semanticSearch', (_e, query: string, scope: string) => semanticSearch(query, scope))

  // ---- AI: image understanding (vision) ----
  ipcMain.handle('ai:describeImage', async (_e, noteId: string, prompt?: string) => {
    const note = getNote(noteId)
    if (!note || note.kind !== 'file' || !(note.mime_type ?? '').startsWith('image/')) {
      throw new Error('该条目不是图片文件')
    }
    const bytes = getFileBytes(noteId)
    if (!bytes) throw new Error('读取图片失败')
    const { id, config, key } = activeChatProvider()
    const provider = getProvider(id, key)
    if (!provider.describeImage) {
      throw new Error(`当前对话 provider(${id})不支持图片识别,请切换到支持视觉的 provider(如 DeepSeek)。`)
    }
    const dataUrl = `data:${note.mime_type};base64,${Buffer.from(bytes).toString('base64')}`
    const p =
      prompt ||
      '请详细描述这张图片的内容,包括其中的文字(OCR)、图表、数据和关键信息,用简洁中文回答。'
    return provider.describeImage(dataUrl, p, { model: config.visionModel || config.chatModel })
  })

  // ---- AI: agentic Q&A (streamed) — the model browses the library with tools ----
  ipcMain.handle('ai:ask', async (e, req: AgentRequest & { requestId: string }) => {
    const ctrl = new AbortController()
    aiAbort.set(req.requestId, ctrl)
    const send = (msg: Record<string, unknown>): void => {
      if (!e.sender.isDestroyed()) e.sender.send('ai:stream', { requestId: req.requestId, ...msg })
    }
    try {
      const r = await runAgent(req, (ev) => send(ev as unknown as Record<string, unknown>), ctrl.signal, e.sender, requireKey)
      send({ type: 'done', model: r.model })
    } catch (err) {
      if (ctrl.signal.aborted) send({ type: 'done', aborted: true })
      else send({ type: 'error', message: friendlyAiError(err) })
    } finally {
      aiAbort.delete(req.requestId)
    }
    return true
  })
  // renderer → main: text extracted for the agent (pdf.js / mammoth / xlsx live there)
  ipcMain.handle('ai:extractResult', (_e, reqId: string, text: string | null) => {
    resolveExtract(reqId, text)
    return true
  })
  // 查找: one box — semantic when a vector index exists, otherwise keyword
  ipcMain.handle('ai:find', (e, query: string) => librarySearch(query, e.sender, 30))
  // models: list from the provider, verify vision with a real call
  ipcMain.handle('ai:refreshModels', (_e, provider: ProviderId) => refreshModels(provider))
  ipcMain.handle('ai:verifyVision', (_e, provider: ProviderId) => verifyVision(provider))
  ipcMain.handle('ai:chatModels', () => {
    const s = getPublicSettings()
    return ALL_PROVIDERS.filter((p) => s.hasKey[p]).map((p) => {
      const cached = s.modelCache[p]?.chat ?? []
      const configured = s.providers[p].chatModel
      const models = [...new Set([configured, ...cached].filter(Boolean))]
      return { provider: p, models, defaultModel: configured }
    })
  })
  ipcMain.handle('ai:testWebSearch', (_e, provider: SearchProviderId) => testWebSearch(provider))
  // web sources open in the system browser (http/https only)
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
      shell.openExternal(u.toString())
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('ai:cancel', (_e, requestId: string) => {
    aiAbort.get(requestId)?.abort()
    return true
  })

  // ---- AI: persistent conversations ----
  ipcMain.handle('chat:list', () => listConversations())
  ipcMain.handle('chat:create', (_e, title?: string, model?: ModelRef | null) => createConversation(title ?? '', model ?? null))
  ipcMain.handle('chat:setModel', (_e, id: string, model: ModelRef | null) => {
    setConversationModel(id, model)
    return true
  })
  ipcMain.handle('chat:deleteMessage', (_e, id: string) => {
    deleteMessage(id)
    return true
  })
  ipcMain.handle('chat:rename', (_e, id: string, title: string) => {
    renameConversation(id, title)
    return true
  })
  ipcMain.handle('chat:delete', (_e, id: string) => {
    deleteConversation(id)
    return true
  })
  ipcMain.handle('chat:messages', (_e, conversationId: string) => listMessages(conversationId))
  ipcMain.handle(
    'chat:addMessage',
    (
      _e,
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      sources: ChatSource[] | null,
      steps?: AgentStep[] | null
    ) => addMessage(conversationId, role, content, sources, steps ?? null)
  )
}

const aiAbort = new Map<string, AbortController>()
