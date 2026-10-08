import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'mock'
/** Web-search backends (keys live in the same encrypted store). */
export type SearchProviderId = 'tavily' | 'brave' | 'mock'
type KeyId = ProviderId | SearchProviderId

export const ALL_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'deepseek', 'mock']

/** Models a provider reported for each use (from its /models endpoint). */
export interface ModelCache {
  chat: string[]
  embed: string[]
  fetchedAt: string
  error?: string
}
/** Result of a REAL vision call (a tiny test image), never an assumption. */
export interface VisionCheck {
  ok: boolean
  model: string
  reason: string
  at: string
}
export interface WebSearchSettings {
  provider: SearchProviderId
  /** Default for new questions (the composer can turn it off per question). */
  enabled: boolean
}

export interface ProviderConfig {
  chatModel: string
  embedModel: string
  visionModel: string
}

/** What each provider can do — drives UI labels and provider-role validity. */
export interface ProviderCaps {
  chat: boolean
  embed: boolean
  /** true/false only after a real test call; null = not verified yet. */
  vision: boolean | null
}
/** Static capabilities; vision is filled in from the stored real-call check. */
const BASE_CAPS: Record<ProviderId, ProviderCaps> = {
  openai: { chat: true, embed: true, vision: null },
  anthropic: { chat: true, embed: false, vision: null },
  google: { chat: true, embed: true, vision: null },
  deepseek: { chat: true, embed: false, vision: null },
  mock: { chat: true, embed: true, vision: false }
}

/** Providers that expose a real vector-embedding API (mock/keyword excluded). */
const VECTOR_PROVIDERS: ProviderId[] = ['openai', 'google']

/** How retrieval runs: real vectors (OpenAI/Google) or keyword fallback. */
export interface RetrievalInfo {
  mode: 'vector' | 'keyword'
  provider?: ProviderId
}

/** Public settings sent to the renderer — NEVER includes API keys. */
export interface PublicAiSettings {
  provider: ProviderId // chat provider
  embedProvider: ProviderId // provider used for embeddings / indexing
  providers: Record<ProviderId, ProviderConfig>
  hasKey: Record<ProviderId, boolean>
  caps: Record<ProviderId, ProviderCaps>
  retrieval: RetrievalInfo
  encryptionAvailable: boolean
  modelCache: Partial<Record<ProviderId, ModelCache>>
  vision: Partial<Record<ProviderId, VisionCheck>>
  webSearch: WebSearchSettings & { hasKey: Record<SearchProviderId, boolean> }
}

const DEFAULTS: Record<ProviderId, ProviderConfig> = {
  openai: { chatModel: 'gpt-4o-mini', embedModel: 'text-embedding-3-small', visionModel: 'gpt-4o-mini' },
  anthropic: { chatModel: 'claude-3-5-sonnet-latest', embedModel: '', visionModel: 'claude-3-5-sonnet-latest' },
  google: { chatModel: 'gemini-1.5-flash', embedModel: 'text-embedding-004', visionModel: 'gemini-1.5-flash' },
  deepseek: { chatModel: 'deepseek-chat', embedModel: '', visionModel: 'deepseek-chat' },
  mock: { chatModel: 'mock-chat', embedModel: 'mock-embed', visionModel: 'mock-vision' }
}

interface StoredSettings {
  provider: ProviderId
  embedProvider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  modelCache: Partial<Record<ProviderId, ModelCache>>
  vision: Partial<Record<ProviderId, VisionCheck>>
  webSearch: WebSearchSettings
}
const DEFAULT_WEB: WebSearchSettings = { provider: 'tavily', enabled: true }

const settingsPath = (): string => join(app.getPath('userData'), 'ai-settings.json')
const keysPath = (): string => join(app.getPath('userData'), 'ai-keys.enc')

function loadStored(): StoredSettings {
  try {
    if (existsSync(settingsPath())) {
      const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<StoredSettings>
      // Per-provider deep merge so newly added fields (e.g. visionModel) always
      // fall back to defaults even for previously-saved provider configs.
      const providers = {} as Record<ProviderId, ProviderConfig>
      ALL_PROVIDERS.forEach((p) => {
        providers[p] = { ...DEFAULTS[p], ...(raw.providers?.[p] ?? {}) }
      })
      return {
        provider: raw.provider ?? 'mock',
        embedProvider: raw.embedProvider ?? 'mock',
        providers,
        modelCache: raw.modelCache ?? {},
        vision: raw.vision ?? {},
        webSearch: { ...DEFAULT_WEB, ...(raw.webSearch ?? {}) }
      }
    }
  } catch {
    /* ignore */
  }
  return { provider: 'mock', embedProvider: 'mock', providers: { ...DEFAULTS }, modelCache: {}, vision: {}, webSearch: { ...DEFAULT_WEB } }
}

function saveStored(s: StoredSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

// ---- keys (encrypted at rest via Electron safeStorage) --------------------
function loadKeys(): Partial<Record<KeyId, string>> {
  try {
    if (!existsSync(keysPath())) return {}
    const buf = readFileSync(keysPath())
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf))
    }
    // Fallback (encryption unavailable on this OS): base64, clearly not secure.
    return JSON.parse(Buffer.from(buf.toString('utf8'), 'base64').toString('utf8'))
  } catch {
    return {}
  }
}
function saveKeys(keys: Partial<Record<KeyId, string>>): void {
  const json = JSON.stringify(keys)
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keysPath(), safeStorage.encryptString(json))
  } else {
    writeFileSync(keysPath(), Buffer.from(json, 'utf8').toString('base64'), 'utf8')
  }
}

export function getKey(provider: KeyId): string | null {
  return loadKeys()[provider] ?? null
}
export function setKey(provider: KeyId, key: string): void {
  const keys = loadKeys()
  if (key) keys[provider] = key
  else delete keys[provider]
  saveKeys(keys)
}

export function getPublicSettings(): PublicAiSettings {
  const s = loadStored()
  const keys = loadKeys()
  const hasKey = {} as Record<ProviderId, boolean>
  ALL_PROVIDERS.forEach((p) => {
    hasKey[p] = p === 'mock' ? true : !!keys[p]
  })
  const real = realEmbeddingProvider()
  const caps = {} as Record<ProviderId, ProviderCaps>
  ALL_PROVIDERS.forEach((p) => {
    const v = s.vision[p]
    caps[p] = { ...BASE_CAPS[p], vision: p === 'mock' ? false : v ? v.ok : null }
  })
  return {
    provider: s.provider,
    embedProvider: s.embedProvider,
    providers: s.providers,
    hasKey,
    caps,
    retrieval: real ? { mode: 'vector', provider: real.id } : { mode: 'keyword' },
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    modelCache: s.modelCache,
    vision: s.vision,
    webSearch: {
      ...s.webSearch,
      hasKey: { tavily: !!keys.tavily, brave: !!keys.brave, mock: true }
    }
  }
}

export function saveSettings(update: {
  provider?: ProviderId
  embedProvider?: ProviderId
  providers?: Partial<Record<ProviderId, ProviderConfig>>
  webSearch?: Partial<WebSearchSettings>
}): PublicAiSettings {
  const s = loadStored()
  if (update.provider) s.provider = update.provider
  if (update.embedProvider) s.embedProvider = update.embedProvider
  if (update.providers) s.providers = { ...s.providers, ...update.providers }
  if (update.webSearch) s.webSearch = { ...s.webSearch, ...update.webSearch }
  saveStored(s)
  return getPublicSettings()
}

interface ActiveProvider {
  id: ProviderId
  config: ProviderConfig
  key: string | null
}

/** Provider used for chat / RAG answering (main-process only). */
export function activeChatProvider(): ActiveProvider {
  const s = loadStored()
  return { id: s.provider, config: s.providers[s.provider], key: getKey(s.provider) }
}

/**
 * The provider that will produce REAL vector embeddings, or null when none is
 * configured. Only OpenAI/Google count — mock's fake vectors are deliberately
 * NOT treated as a real backend. Returns the user's chosen embed provider when
 * it qualifies, otherwise the first OpenAI/Google that has a key + model. When
 * this is null, indexing/retrieval fall back to keyword matching (works with a
 * DeepSeek-only setup, since DeepSeek has no embedding API).
 */
export function realEmbeddingProvider(): ActiveProvider | null {
  const s = loadStored()
  const keys = loadKeys()
  const usable = (p: ProviderId): boolean =>
    VECTOR_PROVIDERS.includes(p) && !!keys[p] && !!s.providers[p].embedModel
  let id: ProviderId | null = usable(s.embedProvider) ? s.embedProvider : null
  if (!id) id = VECTOR_PROVIDERS.find(usable) ?? null
  if (!id) return null
  return { id, config: s.providers[id], key: getKey(id) }
}

/** Back-compat alias — the chat provider. */
export const activeProvider = activeChatProvider

/** Remember the model list a provider reported (or why fetching failed). */
export function saveModelCache(p: ProviderId, cache: ModelCache): void {
  const s = loadStored()
  s.modelCache = { ...s.modelCache, [p]: cache }
  saveStored(s)
}
/** Remember the outcome of a real vision test call. */
export function saveVisionCheck(p: ProviderId, check: VisionCheck): void {
  const s = loadStored()
  s.vision = { ...s.vision, [p]: check }
  saveStored(s)
}
export function providerConfig(p: ProviderId): ProviderConfig {
  return loadStored().providers[p]
}
/** The configured web-search backend + its key, or null when unusable. */
export function activeWebSearch(): { provider: SearchProviderId; key: string | null } | null {
  const s = loadStored()
  const key = getKey(s.webSearch.provider)
  if (s.webSearch.provider !== 'mock' && !key) return null
  return { provider: s.webSearch.provider, key }
}
