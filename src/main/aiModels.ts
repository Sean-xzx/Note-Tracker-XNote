import { deflateSync } from 'zlib'
import { getKey, providerConfig, saveModelCache, saveVisionCheck, type ModelCache, type ProviderId, type VisionCheck } from './aiConfig'
import { getProvider } from './aiProviders'
import { nowIso } from './notes'

// ---------------------------------------------------------------------------
// Model lists — straight from each provider's own models endpoint, split by use.
// ---------------------------------------------------------------------------
const NOT_CHAT = /(embed|embedding|whisper|tts|dall-e|davinci|babbage|moderation|audio|realtime|transcribe|image|search|computer-use|aqa|imagen|veo)/i

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`)
  }
  return res.json()
}

async function fetchModelIds(p: ProviderId, key: string): Promise<{ chat: string[]; embed: string[] }> {
  if (p === 'mock') return { chat: ['mock-chat'], embed: ['mock-embed'] }
  if (p === 'google') {
    const d = (await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`, {})) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[]
    }
    const models = d.models ?? []
    const id = (n: string): string => n.replace(/^models\//, '')
    return {
      chat: models.filter((m) => m.supportedGenerationMethods?.includes('generateContent') && !NOT_CHAT.test(m.name)).map((m) => id(m.name)),
      embed: models.filter((m) => m.supportedGenerationMethods?.some((x) => /embed/i.test(x))).map((m) => id(m.name))
    }
  }
  if (p === 'anthropic') {
    const d = (await getJson('https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    })) as { data?: { id: string }[] }
    return { chat: (d.data ?? []).map((m) => m.id), embed: [] }
  }
  // OpenAI-compatible: OpenAI + DeepSeek
  const base = p === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'
  const d = (await getJson(`${base}/models`, { authorization: `Bearer ${key}` })) as { data?: { id: string }[] }
  const ids = (d.data ?? []).map((m) => m.id).sort()
  return {
    chat: ids.filter((i) => !NOT_CHAT.test(i)),
    embed: ids.filter((i) => /embedding/i.test(i))
  }
}

/** Fetch + cache the provider's models. On failure the cache records why. */
export async function refreshModels(p: ProviderId): Promise<ModelCache> {
  const key = getKey(p)
  let cache: ModelCache
  if (p !== 'mock' && !key) {
    cache = { chat: [], embed: [], fetchedAt: nowIso(), error: '尚未配置 API Key' }
  } else {
    try {
      const r = await fetchModelIds(p, key ?? '')
      cache = { ...r, fetchedAt: nowIso() }
    } catch (e) {
      cache = { chat: [], embed: [], fetchedAt: nowIso(), error: `获取模型列表失败:${(e as Error).message}` }
    }
  }
  saveModelCache(p, cache)
  return cache
}

// ---------------------------------------------------------------------------
// Vision — verified with a real request carrying a tiny solid-red PNG. A model
// only counts as vision-capable if it accepts the image AND says it is red.
// ---------------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** 16×16 solid red PNG as a data URL (built in-process, no asset needed). */
function redSquareDataUrl(): string {
  const size = 16
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([220, 30, 30]))])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

export async function verifyVision(p: ProviderId): Promise<VisionCheck> {
  const cfg = providerConfig(p)
  const model = cfg.visionModel || cfg.chatModel
  const key = getKey(p)
  let check: VisionCheck
  if (p === 'mock') {
    check = { ok: false, model, reason: '模拟 provider 不能识别图片', at: nowIso() }
  } else if (!key) {
    check = { ok: false, model, reason: '尚未配置 API Key,无法验证', at: nowIso() }
  } else {
    const provider = getProvider(p, key)
    try {
      if (!provider.describeImage) throw new Error('该 provider 没有图片接口')
      const reply = await provider.describeImage(redSquareDataUrl(), '这张图片是什么颜色?只回答一个颜色词。', { model })
      const ok = /红|red/i.test(reply)
      check = {
        ok,
        model,
        reason: ok ? `真实调用通过:模型识别出测试图片为「${reply.trim().slice(0, 20)}」` : `模型接受了请求,但没有认出测试图片(回答:「${reply.trim().slice(0, 40)}」)`,
        at: nowIso()
      }
    } catch (e) {
      check = { ok: false, model, reason: `真实调用失败:${(e as Error).message.slice(0, 220)}`, at: nowIso() }
    }
  }
  saveVisionCheck(p, check)
  return check
}
