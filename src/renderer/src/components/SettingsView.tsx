import { useCallback, useEffect, useState } from 'react'
import type { PublicAiSettings, ProviderId, ProviderCaps, SearchProviderId } from '../../../preload'
import { reindex, type IndexProgress } from '../lib/aiIndexRunner'
import { ArrowLeft, Check, X, TriangleAlert, Info, CircleCheck, CircleX, Loader, CircleHelp, RefreshCw, List as ListIcon, ChevronDown, Pencil } from 'lucide-react'
import { IconButton, HlProgress, confirmDialog, Tooltip, Popover, ICON } from './ui'
import { ReviewSettings } from './ReviewSettings'

function Header({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="editor-header">
      <div className="eh-title">
        <IconButton icon={ArrowLeft} label="返回文件库" onClick={onClose} />
        <span className="doc-title">设置</span>
      </div>
    </div>
  )
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  deepseek: 'DeepSeek',
  mock: '本地模拟(测试用,无需 key)'
}
const PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'deepseek', 'mock']
const SEARCH_LABEL: Record<SearchProviderId, string> = { tavily: 'Tavily', brave: 'Brave Search', mock: '模拟搜索(测试用)' }
const SEARCH_PROVIDERS: SearchProviderId[] = ['tavily', 'brave', 'mock']

/** ✓ / ✗ / ? capability chips. Vision is only ✓/✗ after a real test call. */
function Caps({ caps, visionReason }: { caps: ProviderCaps; visionReason?: string }): JSX.Element {
  const chip = (ok: boolean | null, label: string, title?: string): JSX.Element => (
    <span className={`cap ${ok === null ? 'unknown' : ok ? 'yes' : 'no'}`} title={title}>
      {ok === null ? (
        <CircleHelp size={ICON.xxs} strokeWidth={ICON.stroke} />
      ) : ok ? (
        <Check size={ICON.xxs} strokeWidth={ICON.stroke} />
      ) : (
        <X size={ICON.xxs} strokeWidth={ICON.stroke} />
      )}
      {label}
    </span>
  )
  return (
    <span className="provider-caps">
      {chip(caps.chat, '对话')}
      {chip(caps.embed, '索引')}
      {chip(caps.vision, caps.vision === null ? '视觉未验证' : '视觉', visionReason)}
    </span>
  )
}

/** Model picker: the provider's own list + 「自定义…」; manual input when no list. */
function ModelField({
  label,
  value,
  options,
  hint,
  disabled,
  onChange
}: {
  label: string
  value: string
  options: string[]
  hint?: string
  disabled?: boolean
  onChange: (v: string) => void
}): JSX.Element {
  const [custom, setCustom] = useState(false)
  const useSelect = options.length > 0 && !custom
  return (
    <div className="settings-field">
      <label>{label}</label>
      {useSelect ? (
        <Popover
          placement="bottom-start"
          className="menu select-menu"
          trigger={
            <button className="select-trigger" disabled={disabled}>
              <span className="select-value">{value || '选择模型'}</span>
              <ChevronDown size={ICON.xs} strokeWidth={ICON.stroke} />
            </button>
          }
        >
          {(close) => (
            <>
              {(options.includes(value) || !value ? options : [value, ...options]).map((m) => (
                <button
                  key={m}
                  className="menu-item"
                  onClick={() => {
                    onChange(m)
                    close()
                  }}
                >
                  <span className="menu-check">{m === value && <Check size={ICON.xs} strokeWidth={ICON.stroke} />}</span>
                  <span className="menu-text">
                    <span>{m}</span>
                    {!options.includes(m) && <span className="menu-hint">当前,不在列表中</span>}
                  </span>
                </button>
              ))}
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setCustom(true)
                  close()
                }}
              >
                <span className="menu-check">
                  <Pencil size={ICON.xs} strokeWidth={ICON.stroke} />
                </span>
                <span className="menu-text">自定义…</span>
              </button>
            </>
          )}
        </Popover>
      ) : (
        <div className="settings-key-row">
          <input value={value} disabled={disabled} placeholder="手动输入模型名称" onChange={(e) => onChange(e.target.value)} />
          {options.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setCustom(false)}>
              <ListIcon size={ICON.xs} strokeWidth={ICON.stroke} />
              从列表选择
            </button>
          )}
        </div>
      )}
      {hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  )
}

type TestResult = { ok: boolean; message: string }

export function SettingsView({
  onClose,
  onIndexChanged
}: {
  onClose: () => void
  onIndexChanged?: () => void
}): JSX.Element {
  const [settings, setSettings] = useState<PublicAiSettings | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<ProviderId | SearchProviderId, string>>>({})
  const [tests, setTests] = useState<Partial<Record<ProviderId | SearchProviderId, TestResult>>>({})
  const [busy, setBusy] = useState<Partial<Record<string, string>>>({}) // provider → what is running
  const [status, setStatus] = useState<{ indexedNotes: number; totalChunks: number }>({ indexedNotes: 0, totalChunks: 0 })
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [indexing, setIndexing] = useState(false)

  const reloadStatus = useCallback(async () => {
    setStatus(await window.api.ai.indexStatus())
  }, [])
  const reload = useCallback(async () => {
    setSettings(await window.api.ai.getSettings())
  }, [])

  useEffect(() => {
    reload()
    reloadStatus()
  }, [reload, reloadStatus])

  if (!settings) {
    return (
      <>
        <Header onClose={onClose} />
        <div className="doc-scroll" />
      </>
    )
  }

  const s = settings
  const provider = s.provider
  const embedProvider = s.embedProvider
  const running = (k: string, what: string | undefined): void => setBusy((b) => ({ ...b, [k]: what }))

  async function selectChatProvider(p: ProviderId): Promise<void> {
    setSettings(await window.api.ai.saveSettings({ provider: p }))
  }
  async function selectEmbedProvider(p: ProviderId): Promise<void> {
    setSettings(await window.api.ai.saveSettings({ embedProvider: p }))
  }
  async function setModel(target: ProviderId, field: 'chatModel' | 'embedModel' | 'visionModel', value: string): Promise<void> {
    const c = s.providers[target]
    setSettings(await window.api.ai.saveSettings({ providers: { [target]: { ...c, [field]: value } } }))
  }
  /** After a key is saved / tested: fetch the model list and verify vision for real. */
  async function discover(target: ProviderId, withVision: boolean): Promise<void> {
    running(target, '正在获取模型列表…')
    try {
      await window.api.ai.refreshModels(target)
      if (withVision && target !== 'mock') {
        running(target, '正在用测试图片验证视觉能力…')
        await window.api.ai.verifyVision(target)
      }
    } finally {
      running(target, undefined)
      await reload()
    }
  }
  async function saveKey(target: ProviderId): Promise<void> {
    const k = (keyDrafts[target] ?? '').trim()
    if (!k) return
    setSettings(await window.api.ai.setKey(target, k))
    setKeyDrafts((d) => ({ ...d, [target]: '' }))
    setTests((t) => ({ ...t, [target]: undefined }))
    await discover(target, true)
  }
  async function runTest(target: ProviderId): Promise<void> {
    running(target, '测试中…')
    setTests((t) => ({ ...t, [target]: undefined }))
    let r: TestResult
    try {
      r = await window.api.ai.test(target)
    } finally {
      running(target, undefined)
    }
    setTests((t) => ({ ...t, [target]: r }))
    if (r.ok) await discover(target, !s.vision[target])
  }
  async function verifyVision(target: ProviderId): Promise<void> {
    running(target, '正在用测试图片验证视觉能力…')
    try {
      await window.api.ai.verifyVision(target)
    } finally {
      running(target, undefined)
      await reload()
    }
  }
  async function doReindex(force: boolean): Promise<void> {
    setIndexing(true)
    setProgress({ done: 0, total: 0, label: '' })
    try {
      await reindex(setProgress, force)
      await reloadStatus()
      onIndexChanged?.()
    } finally {
      setIndexing(false)
      setProgress(null)
    }
  }
  async function clearIndex(): Promise<void> {
    if (!(await confirmDialog({ title: '清空索引', message: '清空整个文件库索引?之后需要重新「更新索引」。', confirmLabel: '清空', danger: true })))
      return
    setStatus(await window.api.ai.clearIndex())
    onIndexChanged?.()
  }
  // ---- web search ----
  const ws = s.webSearch
  async function selectSearchProvider(p: SearchProviderId): Promise<void> {
    setSettings(await window.api.ai.saveSettings({ webSearch: { provider: p } }))
  }
  async function saveSearchKey(p: SearchProviderId): Promise<void> {
    const k = (keyDrafts[p] ?? '').trim()
    if (!k) return
    setSettings(await window.api.ai.setKey(p, k))
    setKeyDrafts((d) => ({ ...d, [p]: '' }))
    await testSearch(p)
  }
  async function testSearch(p: SearchProviderId): Promise<void> {
    running(p, '测试中…')
    setTests((t) => ({ ...t, [p]: undefined }))
    try {
      const r = await window.api.ai.testWebSearch(p)
      setTests((t) => ({ ...t, [p]: r }))
    } finally {
      running(p, undefined)
    }
  }

  const testLine = (id: ProviderId | SearchProviderId): JSX.Element | null => {
    const t = tests[id]
    const b = busy[id]
    if (b)
      return (
        <span className="settings-test">
          <Loader size={ICON.xs} strokeWidth={ICON.stroke} className="spin" />
          {b}
        </span>
      )
    if (!t) return null
    return (
      <span className={`settings-test ${t.ok ? 'ok' : 'err'}`}>
        {t.ok ? <CircleCheck size={ICON.xs} strokeWidth={ICON.stroke} /> : <CircleX size={ICON.xs} strokeWidth={ICON.stroke} />}
        {t.message}
      </span>
    )
  }

  /** API key + 测试连接. A plain render function (not a nested component), so the
   *  input keeps focus while typing. */
  const keyBlock = (target: ProviderId | SearchProviderId, has: boolean, label: string, onSave: () => void, onTest: () => void): JSX.Element => (
    <>
      <div className="settings-field">
        <label>API Key</label>
        <div className="settings-key-row">
          <input
            type="password"
            placeholder={has ? '已配置(重新输入可覆盖)' : `粘贴 ${label} 的 API Key`}
            value={keyDrafts[target] ?? ''}
            onChange={(e) => setKeyDrafts((d) => ({ ...d, [target]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
          />
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={!(keyDrafts[target] ?? '').trim()}>
            保存密钥
          </button>
        </div>
      </div>
      <div className="settings-test-row">
        <button className="btn btn-secondary btn-sm" onClick={onTest} disabled={!!busy[target]}>
          测试连接
        </button>
        {testLine(target)}
      </div>
    </>
  )

  const cache = s.modelCache[provider]
  const listHint = (p: ProviderId): string | undefined => {
    const c = s.modelCache[p]
    if (p === 'mock') return undefined
    if (!c) return s.hasKey[p] ? '尚未获取模型列表 —— 点「测试连接」后自动获取' : '保存 API Key 后会自动获取可用模型'
    if (c.error) return `${c.error}(可手动输入)`
    return undefined
  }
  const vision = s.vision[provider]

  return (
    <>
      <Header onClose={onClose} />
      <div className="doc-scroll settings-scroll">
        <div className="settings-body">
          <ReviewSettings />

          {/* ---- Chat provider ---- */}
          <section className="settings-section">
            <h3>对话模型 Provider</h3>
            <p className="settings-hint">AI 提问默认使用的服务。聊天框左下角可以为每个对话单独切换模型。</p>
            <div className="settings-providers">
              {PROVIDERS.map((p) => (
                <button key={p} className={`provider-btn ${provider === p ? 'active' : ''}`} onClick={() => selectChatProvider(p)}>
                  <span className="provider-name">
                    {PROVIDER_LABEL[p]}
                    {s.hasKey[p] && p !== 'mock' && <span className="provider-ok">已配置</span>}
                  </span>
                  <Caps caps={s.caps[p]} visionReason={s.vision[p]?.reason} />
                </button>
              ))}
            </div>

            {!s.caps[provider].embed && (
              <p className="settings-note-warn">
                <TriangleAlert size={ICON.xs} strokeWidth={ICON.stroke} />
                {PROVIDER_LABEL[provider]} 没有向量 embedding 接口。仅配置它时,文件库检索使用【关键词检索】;如需语义(向量)检索,请在下方为 OpenAI 或
                Google 配置 key。
              </p>
            )}

            {provider !== 'mock' && keyBlock(provider, s.hasKey[provider], PROVIDER_LABEL[provider], () => saveKey(provider), () => runTest(provider))}

            <ModelField
              label="Chat 模型"
              value={s.providers[provider].chatModel}
              options={cache?.chat ?? []}
              hint={listHint(provider)}
              disabled={provider === 'mock'}
              onChange={(v) => setModel(provider, 'chatModel', v)}
            />
            {provider !== 'mock' && (
              <>
                <ModelField
                  label="视觉模型(图片识别 / OCR)"
                  value={s.providers[provider].visionModel}
                  options={cache?.chat ?? []}
                  onChange={(v) => setModel(provider, 'visionModel', v)}
                />
                <div className="vision-check">
                  <span className={`cap ${vision ? (vision.ok ? 'yes' : 'no') : 'unknown'}`}>
                    {vision ? vision.ok ? <Check size={ICON.xxs} strokeWidth={ICON.stroke} /> : <X size={ICON.xxs} strokeWidth={ICON.stroke} /> : <CircleHelp size={ICON.xxs} strokeWidth={ICON.stroke} />}
                    {vision ? (vision.ok ? '视觉可用' : '视觉不可用') : '视觉未验证'}
                  </span>
                  <span className="vision-reason">
                    {vision ? `${vision.reason}(模型 ${vision.model})` : '用一张测试图片真实调用一次后才会标注。'}
                  </span>
                  <Tooltip label="发送一张 16×16 的测试图片,确认该模型能否识别">
                    <button className="btn btn-ghost btn-sm" disabled={!s.hasKey[provider] || !!busy[provider]} onClick={() => verifyVision(provider)}>
                      <RefreshCw size={ICON.xs} strokeWidth={ICON.stroke} />
                      {vision ? '重新验证' : '验证'}
                    </button>
                  </Tooltip>
                </div>
              </>
            )}
          </section>

          {/* ---- Web search ---- */}
          <section className="settings-section">
            <h3>联网搜索</h3>
            <p className="settings-hint">AI 提问时可联网查找文件库之外或最新的信息。DeepSeek 等模型本身不联网,需要接入搜索服务。</p>
            <div className="settings-providers">
              {SEARCH_PROVIDERS.map((p) => (
                <button key={p} className={`provider-btn ${ws.provider === p ? 'active' : ''}`} onClick={() => selectSearchProvider(p)}>
                  <span className="provider-name">
                    {SEARCH_LABEL[p]}
                    {ws.hasKey[p] && p !== 'mock' && <span className="provider-ok">已配置</span>}
                  </span>
                </button>
              ))}
            </div>
            {ws.provider !== 'mock'
              ? keyBlock(ws.provider, ws.hasKey[ws.provider], SEARCH_LABEL[ws.provider], () => saveSearchKey(ws.provider), () => testSearch(ws.provider))
              : (
                <div className="settings-test-row">
                  <button className="btn btn-secondary btn-sm" onClick={() => testSearch('mock')}>
                    测试连接
                  </button>
                  {testLine('mock')}
                </div>
              )}
            <label className="check-row">
              <input
                type="checkbox"
                className="check"
                checked={ws.enabled}
                onChange={async (e) => setSettings(await window.api.ai.saveSettings({ webSearch: { enabled: e.target.checked } }))}
              />
              新提问默认开启联网(聊天框里的地球按钮可对单条提问关闭)
            </label>
          </section>

          {/* ---- Embedding / index provider ---- */}
          <section className="settings-section">
            <h3>索引 / 向量 Provider(embedding)</h3>
            <p className="settings-hint">用于把文件切片成向量、做语义检索。仅支持 embedding 的 provider 可选。</p>
            <div className="settings-providers">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  className={`provider-btn ${embedProvider === p ? 'active' : ''}`}
                  disabled={!s.caps[p].embed}
                  title={!s.caps[p].embed ? `${PROVIDER_LABEL[p]} 不支持向量索引` : ''}
                  onClick={() => selectEmbedProvider(p)}
                >
                  <span className="provider-name">
                    {PROVIDER_LABEL[p]}
                    {!s.caps[p].embed && <span className="provider-nocap">不支持索引</span>}
                    {s.caps[p].embed && s.hasKey[p] && p !== 'mock' && <span className="provider-ok">已配置</span>}
                  </span>
                </button>
              ))}
            </div>

            {embedProvider !== provider &&
              embedProvider !== 'mock' &&
              keyBlock(embedProvider, s.hasKey[embedProvider], PROVIDER_LABEL[embedProvider], () => saveKey(embedProvider), () => runTest(embedProvider))}

            <ModelField
              label="Embedding 模型"
              value={s.providers[embedProvider].embedModel}
              options={s.modelCache[embedProvider]?.embed ?? []}
              hint={listHint(embedProvider)}
              disabled={embedProvider === 'mock'}
              onChange={(v) => setModel(embedProvider, 'embedModel', v)}
            />

            {s.retrieval.mode === 'keyword' ? (
              <p className="settings-note-warn">
                当前检索后端:【关键词检索】(没有可用的向量 embedding provider)。AI 与「查找」会对标题和正文做全文匹配;如需语义检索请为 OpenAI 或 Google 配置
                key,配置后自动切换。
              </p>
            ) : (
              <p className="settings-hint">当前检索后端:【语义向量检索】,由 {PROVIDER_LABEL[s.retrieval.provider!]} 生成向量。</p>
            )}

            <p className="settings-privacy">
              <Info size={ICON.xs} strokeWidth={ICON.stroke} />
              启用 AI 后,AI 查阅到的文件内容与文件清单会发送给对应的 API 提供商,用于生成回答;联网搜索会把搜索词发送给搜索服务。 密钥经系统加密后保存在本地(
              {s.encryptionAvailable ? 'safeStorage 已加密' : '当前系统不支持加密,已降级保存'}),不会写入代码或明文,界面进程不持有密钥。
            </p>
          </section>

          <section className="settings-section">
            <h3>文件库索引</h3>
            <div className="settings-index-status">
              已索引 {status.indexedNotes} 个条目 · {status.totalChunks} 个片段
              <span className="settings-index-by">
                {' · '}
                {s.retrieval.mode === 'vector' ? `语义向量检索(${PROVIDER_LABEL[s.retrieval.provider!]})` : '关键词检索'}
              </span>
            </div>
            {progress && (
              <div className="settings-progress">
                <HlProgress value={progress.total ? progress.done / progress.total : 0} />
                <div className="settings-progress-label">
                  索引中 {progress.done}/{progress.total} · {progress.label}
                </div>
              </div>
            )}
            <div className="settings-index-actions">
              <button className="btn btn-primary btn-sm" onClick={() => doReindex(false)} disabled={indexing}>
                更新索引(增量)
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => doReindex(true)} disabled={indexing}>
                重建索引(全量)
              </button>
              <button className="btn btn-ghost btn-sm" onClick={clearIndex} disabled={indexing}>
                清空索引
              </button>
            </div>
            <p className="settings-hint">
              AI 提问和「查找」不依赖索引也能读取全部文件;建立索引(配合 OpenAI / Google 向量)后检索会更快、更懂语义。
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
