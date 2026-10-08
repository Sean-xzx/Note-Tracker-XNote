import { listNotes } from './notes'
import { readNoteFile } from './noteFiles'

// API key is read from the environment for now; a settings UI will supply it
// later. NEVER hardcode a key here.
const AI_API_KEY = process.env.XNOTE_AI_API_KEY ?? ''

/** Whether a real LLM backend is configured. When true, aiSearch could call an
 *  API instead of the local keyword search (see the TODO in aiSearch). */
export function isAiConfigured(): boolean {
  return AI_API_KEY.length > 0
}

/** One search result: the note plus a short context snippet around the hit. */
export interface AiSearchHit {
  id: string
  title: string
  snippet: string
}

/** Build a ~70-char context window around the first occurrence of `q`. */
function makeSnippet(title: string, body: string, q: string): string {
  const source = body || title
  const i = source.toLowerCase().indexOf(q)
  if (i < 0) return title || '无标题'

  const start = Math.max(0, i - 30)
  const end = Math.min(source.length, i + q.length + 40)
  let s = source.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < source.length) s = s + '…'
  return s
}

/**
 * Search notes for `query`. v1 does a local case-insensitive keyword match over
 * each note's title + markdown body.
 *
 * TODO(ai): when an API key is configured, replace this local search with a
 * call to an LLM for semantic search / Q&A. Keep the AiSearchHit return shape
 * so the renderer doesn't change. The key will come from settings (see
 * AI_API_KEY above) rather than being hardcoded.
 */
export function aiSearch(query: string): AiSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  // TODO(ai): if (isAiConfigured()) return await llmSemanticSearch(query)
  const hits: AiSearchHit[] = []
  for (const note of listNotes()) {
    const title = note.title ?? ''
    const body = readNoteFile(note.id) ?? ''
    if ((title + '\n' + body).toLowerCase().includes(q)) {
      hits.push({
        id: note.id,
        title: title || '无标题',
        snippet: makeSnippet(title, body, q)
      })
    }
  }
  return hits
}
