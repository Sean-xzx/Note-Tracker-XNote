import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Note, NoteUpdate, NoteContent } from '../main/notes'
import type { Rating, ReviewStats, QueueResult, ReviewHistoryEntry, ParamGroup, ReviewPrefs, SimPattern, OptimizeResult, MigrationReport } from '../main/review'
import type { GroupParams } from '../main/fsrs'
import type { AiSearchHit } from '../main/ai'
import type { PublicAiSettings, ProviderId, ProviderConfig, SearchProviderId, WebSearchSettings, ModelCache, VisionCheck } from '../main/aiConfig'
import type { SemanticHit, IndexResult, PlanItem } from '../main/aiIndex'
import type { Conversation, StoredMessage } from '../main/aiChat'
import type { AgentRequest, AgentStep, ChatSource, ModelRef } from '../main/aiAgent'
import type { LibraryHit } from '../main/aiLibrary'
import type { Annotation, AnnotationWithNote, NewAnnotation, AnnoType, AnnoAnchor } from '../main/annotations'

/** One streamed AI event. */
type AiStreamEvent =
  | { requestId: string; type: 'step'; step: AgentStep }
  | { requestId: string; type: 'delta'; delta: string }
  | { requestId: string; type: 'retract' }
  | { requestId: string; type: 'sources'; sources: ChatSource[] }
  | { requestId: string; type: 'done'; model?: ModelRef; aborted?: boolean }
  | { requestId: string; type: 'error'; message: string }

// The preload runs in an isolated context. We expose a small, explicit API to
// the renderer via contextBridge — never the raw ipcRenderer. Everything that
// touches SQLite lives in the main process and is reached over IPC.
const api = {
  ping: (): string => 'pong',
  notes: {
    create: (title: string, parentId: string | null = null): Promise<Note> =>
      ipcRenderer.invoke('notes:create', title, parentId),
    get: (id: string): Promise<Note | null> =>
      ipcRenderer.invoke('notes:get', id),
    list: (): Promise<Note[]> => ipcRenderer.invoke('notes:list'),
    getDue: (date?: string): Promise<Note[]> =>
      ipcRenderer.invoke('notes:getDue', date),
    update: (id: string, fields: NoteUpdate): Promise<Note | null> =>
      ipcRenderer.invoke('notes:update', id, fields),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('notes:delete', id),
    saveContent: (id: string, content: string): Promise<Note | null> =>
      ipcRenderer.invoke('notes:saveContent', id, content),
    getContent: (id: string): Promise<NoteContent | null> =>
      ipcRenderer.invoke('notes:getContent', id),
    addToReview: (id: string): Promise<Note | null> =>
      ipcRenderer.invoke('notes:addToReview', id)
  },
  review: {
    review: (id: string, rating: Rating): Promise<Note | null> =>
      ipcRenderer.invoke('review:review', id, rating),
    stats: (id: string): Promise<ReviewStats | null> =>
      ipcRenderer.invoke('review:stats', id),
    queue: (): Promise<QueueResult> => ipcRenderer.invoke('review:queue'),
    /** durationMs: time from opening the note to submitting (idle stretches capped at 10 min) */
    complete: (id: string, rating: Rating, reflection: string, durationMs?: number): Promise<{ note: Note | null; logId: string } | null> =>
      ipcRenderer.invoke('review:complete', id, rating, reflection, durationMs),
    history: (noteId: string): Promise<ReviewHistoryEntry[]> => ipcRenderer.invoke('review:history', noteId),
    summary: (): Promise<{ reviewedToday: number; reflectionsToday: number; dueTomorrow: number }> =>
      ipcRenderer.invoke('review:summary'),
    /** next interval for each of the four ratings */
    preview: (id: string): Promise<Record<Rating, { interval: number; due: string }> | null> => ipcRenderer.invoke('review:preview', id),
    groups: (): Promise<ParamGroup[]> => ipcRenderer.invoke('review:groups'),
    createGroup: (name: string): Promise<ParamGroup[]> => ipcRenderer.invoke('review:createGroup', name),
    renameGroup: (id: string, name: string): Promise<ParamGroup[]> => ipcRenderer.invoke('review:renameGroup', id, name),
    deleteGroup: (id: string): Promise<ParamGroup[]> => ipcRenderer.invoke('review:deleteGroup', id),
    updateGroup: (id: string, patch: Partial<GroupParams>): Promise<ParamGroup[]> => ipcRenderer.invoke('review:updateGroup', id, patch),
    assignFolder: (folderId: string, groupId: string | null): Promise<ParamGroup[]> => ipcRenderer.invoke('review:assignFolder', folderId, groupId),
    prefs: (): Promise<ReviewPrefs> => ipcRenderer.invoke('review:prefs'),
    savePrefs: (patch: Partial<ReviewPrefs>): Promise<ReviewPrefs> => ipcRenderer.invoke('review:savePrefs', patch),
    simulate: (groupId: string, pattern: SimPattern): Promise<{ date: string; grade: Rating; interval: number }[]> =>
      ipcRenderer.invoke('review:simulate', groupId, pattern),
    optimize: (groupId: string): Promise<OptimizeResult> => ipcRenderer.invoke('review:optimize', groupId),
    applyWeights: (groupId: string, w: number[] | null): Promise<ParamGroup[]> => ipcRenderer.invoke('review:applyWeights', groupId, w),
    migrationReport: (): Promise<MigrationReport | null> => ipcRenderer.invoke('review:migrationReport'),
    setExamDate: (id: string, date: string | null): Promise<Note | null> => ipcRenderer.invoke('notes:setExamDate', id, date)
  },
  folders: {
    create: (name: string, parentId: string | null = null): Promise<Note> =>
      ipcRenderer.invoke('folders:create', name, parentId)
  },
  tree: {
    list: (): Promise<Note[]> => ipcRenderer.invoke('tree:list'),
    rename: (id: string, title: string): Promise<Note | null> =>
      ipcRenderer.invoke('tree:rename', id, title),
    move: (
      id: string,
      newParentId: string | null,
      newSortOrder: number
    ): Promise<Note | null> =>
      ipcRenderer.invoke('tree:move', id, newParentId, newSortOrder),
    softDelete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('tree:softDelete', id),
    restore: (id: string): Promise<Note | null> =>
      ipcRenderer.invoke('tree:restore', id),
    listTrash: (): Promise<Note[]> => ipcRenderer.invoke('tree:listTrash'),
    permanentlyDelete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('tree:permanentlyDelete', id),
    emptyTrash: (): Promise<number> => ipcRenderer.invoke('tree:emptyTrash')
  },
  files: {
    // Open the native picker and create a file item per selection.
    upload: (parentId: string | null = null): Promise<Note[]> =>
      ipcRenderer.invoke('files:upload', parentId),
    // Create a file item from an absolute path (drag-and-drop).
    add: (filePath: string, parentId: string | null = null): Promise<Note> =>
      ipcRenderer.invoke('files:add', filePath, parentId),
    // Raw bytes for pdf.js / mammoth / SheetJS viewers.
    getBytes: (id: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('files:getBytes', id),
    // Save edited text back to a text file item.
    saveText: (id: string, content: string): Promise<Note | null> =>
      ipcRenderer.invoke('files:saveText', id, content),
    // Replace a file item's content with a newly-picked file.
    replace: (id: string): Promise<Note | null> =>
      ipcRenderer.invoke('files:replace', id),
    // Fallback: open in the OS default app.
    openInSystem: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('files:open', id),
    // Custom-protocol URL for <img> sources (streamed by the main process).
    imageUrl: (id: string): string => `xnote-file://${id}`,
    // Resolve a dropped File to its absolute path (drag-and-drop upload).
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    // Save pasted / dropped image bytes as a library file next to the note.
    addImage: (noteId: string, name: string, bytes: Uint8Array): Promise<Note> =>
      ipcRenderer.invoke('files:addImage', noteId, name, bytes)
  },
  annotations: {
    add: (noteId: string, data: NewAnnotation): Promise<Annotation> =>
      ipcRenderer.invoke('anno:add', noteId, data),
    list: (noteId: string): Promise<Annotation[]> =>
      ipcRenderer.invoke('anno:list', noteId),
    update: (
      id: string,
      fields: { color?: string; note_text?: string | null; type?: AnnoType }
    ): Promise<Annotation | null> => ipcRenderer.invoke('anno:update', id, fields),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('anno:delete', id),
    restore: (a: Annotation): Promise<Annotation> => ipcRenderer.invoke('anno:restore', a),
    // markdown: persist anchors re-located after edits / migrated from the old preview offsets
    updateAnchors: (items: { id: string; anchor: AnnoAnchor; quote: string }[]): Promise<number> =>
      ipcRenderer.invoke('anno:updateAnchors', items),
    listAll: (): Promise<AnnotationWithNote[]> => ipcRenderer.invoke('anno:listAll'),
    byDate: (from?: string, to?: string): Promise<AnnotationWithNote[]> =>
      ipcRenderer.invoke('anno:byDate', from, to)
  },
  ai: {
    // keyword search (fallback)
    search: (query: string): Promise<AiSearchHit[]> =>
      ipcRenderer.invoke('ai:search', query),
    // settings (keys never cross this boundary)
    getSettings: (): Promise<PublicAiSettings> => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: (update: {
      provider?: ProviderId
      embedProvider?: ProviderId
      providers?: Partial<Record<ProviderId, ProviderConfig>>
      webSearch?: Partial<WebSearchSettings>
    }): Promise<PublicAiSettings> => ipcRenderer.invoke('ai:saveSettings', update),
    setKey: (provider: ProviderId | SearchProviderId, key: string): Promise<PublicAiSettings> =>
      ipcRenderer.invoke('ai:setKey', provider, key),
    test: (provider: ProviderId): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('ai:test', provider),
    // indexing
    indexPlan: (items: PlanItem[]): Promise<{ toIndex: string[]; upToDate: number }> =>
      ipcRenderer.invoke('ai:indexPlan', items),
    indexNote: (noteId: string, text: string): Promise<IndexResult | { status: 'error'; error: string }> =>
      ipcRenderer.invoke('ai:indexNote', noteId, text),
    clearIndex: (noteId?: string): Promise<{ indexedNotes: number; totalChunks: number }> =>
      ipcRenderer.invoke('ai:clearIndex', noteId),
    indexStatus: (): Promise<{ indexedNotes: number; totalChunks: number }> =>
      ipcRenderer.invoke('ai:indexStatus'),
    // semantic search
    semanticSearch: (query: string, scope: string): Promise<SemanticHit[]> =>
      ipcRenderer.invoke('ai:semanticSearch', query, scope),
    // agentic QA (streamed): the model browses the library with tools
    ask: (req: AgentRequest & { requestId: string }): Promise<boolean> => ipcRenderer.invoke('ai:ask', req),
    // 查找: one box, semantic or keyword chosen by main
    find: (query: string): Promise<LibraryHit[]> => ipcRenderer.invoke('ai:find', query),
    // models + real vision verification
    refreshModels: (provider: ProviderId): Promise<ModelCache> => ipcRenderer.invoke('ai:refreshModels', provider),
    verifyVision: (provider: ProviderId): Promise<VisionCheck> => ipcRenderer.invoke('ai:verifyVision', provider),
    chatModels: (): Promise<{ provider: ProviderId; models: string[]; defaultModel: string }[]> =>
      ipcRenderer.invoke('ai:chatModels'),
    testWebSearch: (provider: SearchProviderId): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('ai:testWebSearch', provider),
    // main asks the renderer to extract text (pdf.js / mammoth / xlsx live here)
    onExtractRequest: (cb: (req: { reqId: string; id: string }) => void): (() => void) => {
      const listener = (_e: unknown, data: { reqId: string; id: string }): void => cb(data)
      ipcRenderer.on('ai:extractRequest', listener)
      return () => ipcRenderer.removeListener('ai:extractRequest', listener)
    },
    extractResult: (reqId: string, text: string | null): Promise<boolean> =>
      ipcRenderer.invoke('ai:extractResult', reqId, text),
    cancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke('ai:cancel', requestId),
    // image understanding (vision)
    describeImage: (noteId: string, prompt?: string): Promise<string> =>
      ipcRenderer.invoke('ai:describeImage', noteId, prompt),
    onStream: (cb: (e: AiStreamEvent) => void): (() => void) => {
      const listener = (_e: unknown, data: AiStreamEvent): void => cb(data)
      ipcRenderer.on('ai:stream', listener)
      return () => ipcRenderer.removeListener('ai:stream', listener)
    }
  },
  chat: {
    list: (): Promise<Conversation[]> => ipcRenderer.invoke('chat:list'),
    create: (title?: string, model?: ModelRef | null): Promise<Conversation> => ipcRenderer.invoke('chat:create', title, model),
    setModel: (id: string, model: ModelRef | null): Promise<boolean> => ipcRenderer.invoke('chat:setModel', id, model),
    deleteMessage: (id: string): Promise<boolean> => ipcRenderer.invoke('chat:deleteMessage', id),
    rename: (id: string, title: string): Promise<boolean> => ipcRenderer.invoke('chat:rename', id, title),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('chat:delete', id),
    messages: (conversationId: string): Promise<StoredMessage[]> => ipcRenderer.invoke('chat:messages', conversationId),
    addMessage: (
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      sources: ChatSource[] | null,
      steps?: AgentStep[] | null
    ): Promise<StoredMessage> => ipcRenderer.invoke('chat:addMessage', conversationId, role, content, sources, steps)
  },
  app: {
    /** Open an http(s) link in the system browser. */
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('api', api)

// Type of the exposed API, imported by the renderer for autocomplete.
export type XNoteApi = typeof api

// Re-export the domain types so the renderer can import them from one place.
export type { Note, NoteUpdate, NoteContent } from '../main/notes'
export type { Rating, ReviewStats, QueueItem, QueueGroup, QueueResult, ReviewHistoryEntry, ParamGroup, ReviewPrefs, SimPattern, OptimizeResult, MigrationReport } from '../main/review'
export type { GroupParams } from '../main/fsrs'
export type { AiSearchHit } from '../main/ai'
export type {
  PublicAiSettings,
  ProviderId,
  ProviderConfig,
  ProviderCaps,
  RetrievalInfo,
  SearchProviderId,
  WebSearchSettings,
  ModelCache,
  VisionCheck
} from '../main/aiConfig'
export type { SemanticHit, IndexResult, PlanItem } from '../main/aiIndex'
export type { Conversation, StoredMessage } from '../main/aiChat'
export type { AgentRequest, AgentStep, ChatSource, ModelRef, StepTool } from '../main/aiAgent'
export type { LibraryHit, ItemKind } from '../main/aiLibrary'
export type {
  Annotation,
  AnnotationWithNote,
  NewAnnotation,
  AnnoType,
  AnnoAnchor,
  AnnoLocator,
  TextLocator,
  PdfLocator,
  RectLocator,
  DrawingLocator,
  MdLocator
} from '../main/annotations'
