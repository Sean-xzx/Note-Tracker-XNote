import { getKey, type SearchProviderId } from './aiConfig'

/** One web result, normalised across backends. */
export interface WebResult {
  title: string
  url: string
  snippet: string
}

interface SearchBackend {
  search(query: string, opts: { count: number; signal?: AbortSignal }): Promise<WebResult[]>
}

async function failIfBad(res: Response): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 200)
  } catch {
    /* ignore */
  }
  throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`)
}

/** Tavily — https://docs.tavily.com (POST /search, bearer key). */
class Tavily implements SearchBackend {
  constructor(private key: string) {}
  async search(query: string, opts: { count: number; signal?: AbortSignal }): Promise<WebResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ query, max_results: opts.count, search_depth: 'basic', include_answer: false }),
      signal: opts.signal
    })
    await failIfBad(res)
    const d = (await res.json()) as { results?: { title?: string; url: string; content?: string }[] }
    return (d.results ?? []).map((r) => ({ title: r.title || r.url, url: r.url, snippet: (r.content ?? '').slice(0, 600) }))
  }
}

/** Brave Search — https://api.search.brave.com (GET /res/v1/web/search). */
class Brave implements SearchBackend {
  constructor(private key: string) {}
  async search(query: string, opts: { count: number; signal?: AbortSignal }): Promise<WebResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts.count}`
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-subscription-token': this.key },
      signal: opts.signal
    })
    await failIfBad(res)
    const d = (await res.json()) as { web?: { results?: { title?: string; url: string; description?: string }[] } }
    return (d.web?.results ?? []).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: (r.description ?? '').replace(/<[^>]+>/g, '').slice(0, 600)
    }))
  }
}

/** Test double (no key, no network). Results are clearly marked as simulated. */
class MockSearch implements SearchBackend {
  async search(query: string, opts: { count: number }): Promise<WebResult[]> {
    return Array.from({ length: Math.min(3, opts.count) }, (_, i) => ({
      title: `(模拟)关于「${query.slice(0, 20)}」的网页 ${i + 1}`,
      url: `https://example.com/simulated-${i + 1}`,
      snippet: '这是模拟联网搜索返回的示例摘要,仅用于测试界面与流程,并非真实网页内容。'
    }))
  }
}

export function getSearchBackend(p: SearchProviderId, key: string | null): SearchBackend {
  if (p === 'tavily') return new Tavily(key ?? '')
  if (p === 'brave') return new Brave(key ?? '')
  return new MockSearch()
}

export const SEARCH_PROVIDER_NAME: Record<SearchProviderId, string> = { tavily: 'Tavily', brave: 'Brave Search', mock: '模拟搜索' }

/** "测试连接" for the settings page. */
export async function testWebSearch(p: SearchProviderId): Promise<{ ok: boolean; message: string }> {
  const key = getKey(p)
  if (p !== 'mock' && !key) return { ok: false, message: `尚未配置 ${SEARCH_PROVIDER_NAME[p]} 的 API Key` }
  try {
    const r = await getSearchBackend(p, key).search('XNote spaced repetition', { count: 3 })
    return r.length ? { ok: true, message: `连接成功,返回 ${r.length} 条结果` } : { ok: true, message: '连接成功(没有返回结果)' }
  } catch (e) {
    return { ok: false, message: `连接失败:${(e as Error).message}` }
  }
}
