import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getDb } from './db'
import { listTree, getNote, localDate, type Note } from './notes'
import { readNoteFile } from './noteFiles'
import { readStoredBytes } from './fileStore'
import { realEmbeddingProvider } from './aiConfig'
import { semanticSearch, queryTerms, keywordScore } from './aiIndex'

// ---------------------------------------------------------------------------
// Library shape: types, folder paths, the manifest given to the model.
// ---------------------------------------------------------------------------
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'xml', 'yml', 'yaml', 'ini', 'js', 'ts', 'tsx', 'jsx', 'py', 'java',
  'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'html', 'css', 'json', 'csv'
])
const extOf = (n: Note): string => (n.original_name?.split('.').pop() ?? '').toLowerCase()

export type ItemKind = 'folder' | 'note' | 'pdf' | 'doc' | 'sheet' | 'image' | 'text' | 'file'
export function itemKind(n: Note): ItemKind {
  if (n.kind === 'folder') return 'folder'
  if (n.kind === 'markdown') return 'note'
  const mime = n.mime_type ?? ''
  const ext = extOf(n)
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'doc'
  if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('spreadsheet') || mime === 'text/csv') return 'sheet'
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTS.has(ext)) return 'text'
  return 'file'
}
export const KIND_LABEL: Record<ItemKind, string> = {
  folder: '文件夹',
  note: 'Markdown 笔记',
  pdf: 'PDF',
  doc: 'Word 文档',
  sheet: '表格',
  image: '图片',
  text: '文本文件',
  file: '文件'
}

/** "学习方法 / 子文件夹" for an item (its containing folders; "" at top level). */
export function folderPath(n: Note, byId: Map<string, Note>): string {
  const parts: string[] = []
  let p = n.parent_id ? byId.get(n.parent_id) : undefined
  let guard = 0
  while (p && guard++ < 50) {
    parts.unshift(p.title || '未命名文件夹')
    p = p.parent_id ? byId.get(p.parent_id) : undefined
  }
  return parts.join(' / ')
}

export interface LibraryItem {
  id: string
  title: string
  kind: ItemKind
  path: string
  updated: string
}
export function libraryItems(): LibraryItem[] {
  const all = listTree()
  const byId = new Map(all.map((n) => [n.id, n]))
  return all.map((n) => ({
    id: n.id,
    title: n.title || '无标题',
    kind: itemKind(n),
    path: folderPath(n, byId),
    updated: localDate(new Date(n.updated_at))
  }))
}

const MANIFEST_MAX = 400
/** Compact list of every item for the system prompt (titles only, never bodies). */
export function libraryManifest(): { text: string; total: number; files: number; folders: number } {
  const items = libraryItems()
  const folders = items.filter((i) => i.kind === 'folder').length
  const lines = items
    .slice(0, MANIFEST_MAX)
    .map((i) => `- ${i.kind === 'folder' ? '[文件夹] ' : ''}${i.title}(${KIND_LABEL[i.kind]} · 位置:${i.path || '顶层'} · 更新 ${i.updated} · id=${i.id})`)
  if (items.length > MANIFEST_MAX) lines.push(`…(另有 ${items.length - MANIFEST_MAX} 项未列出,可用 list_files / search_library 查看)`)
  return { text: lines.join('\n'), total: items.length, files: items.length - folders, folders }
}

// ---------------------------------------------------------------------------
// Text access. Markdown / plain text are read here; PDF, docx, xlsx use the
// renderer's existing extractors (pdf.js / mammoth / xlsx) via a request/reply
// bridge. Results are cached per item version.
// ---------------------------------------------------------------------------
const cache = new Map<string, { updated: string; text: string }>()
const CACHE_MAX = 200
const pending = new Map<string, (text: string | null) => void>()

/** Called by the ipc handler when the renderer answers an extraction request. */
export function resolveExtract(reqId: string, text: string | null): void {
  pending.get(reqId)?.(text)
  pending.delete(reqId)
}

function extractInRenderer(sender: WebContents | null, id: string, timeoutMs = 30000): Promise<string | null> {
  if (!sender || sender.isDestroyed()) return Promise.resolve(null)
  const reqId = randomUUID()
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(reqId)
      resolve(null)
    }, timeoutMs)
    pending.set(reqId, (text) => {
      clearTimeout(t)
      resolve(text)
    })
    sender.send('ai:extractRequest', { reqId, id })
  })
}

/** Text from the vector/keyword index, when the item was indexed. */
function indexedText(id: string): string | null {
  const rows = getDb().prepare(`SELECT text FROM chunks WHERE note_id = ? ORDER BY chunk_index`).all(id) as { text: string }[]
  return rows.length ? rows.map((r) => r.text).join('\n') : null
}

export async function itemText(id: string, sender: WebContents | null): Promise<string | null> {
  const n = getNote(id)
  if (!n || n.deleted_at || n.kind === 'folder') return null
  const hit = cache.get(id)
  if (hit && hit.updated === n.updated_at) return hit.text
  let text: string | null = null
  const kind = itemKind(n)
  if (kind === 'note') text = readNoteFile(id) ?? ''
  else if (kind === 'text' && n.stored_name) {
    try {
      text = new TextDecoder('utf-8').decode(readStoredBytes(n.stored_name))
    } catch {
      text = null
    }
  } else if (kind === 'image') text = indexedText(id) // described by the vision model when indexed
  else {
    text = await extractInRenderer(sender, id)
    if (text == null || text === n.title) text = indexedText(id) ?? text
  }
  if (text != null) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(id, { updated: n.updated_at, text })
  }
  return text
}

// ---------------------------------------------------------------------------
// Library search (the 查找 tab and the search_library tool). Semantic when a
// vector index exists, otherwise keyword over titles + full text.
// ---------------------------------------------------------------------------
export interface LibraryHit {
  noteId: string
  title: string
  kind: ItemKind
  path: string
  snippet: string
  /** Terms to highlight in the snippet. */
  terms: string[]
  score: number
  mode: 'semantic' | 'keyword'
}

function snippetAround(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (pos < 0 || i < pos)) pos = i
  }
  if (pos < 0) return flat.slice(0, 140) + (flat.length > 140 ? '…' : '')
  const start = Math.max(0, pos - 50)
  const end = Math.min(flat.length, pos + 110)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

const EXTRACT_BUDGET = 25 // binaries extracted per keyword search (cached afterwards)

export async function librarySearch(query: string, sender: WebContents | null, limit = 12): Promise<LibraryHit[]> {
  const q = query.trim()
  if (!q) return []
  const all = listTree()
  const byId = new Map(all.map((n) => [n.id, n]))
  const terms = queryTerms(q)

  if (realEmbeddingProvider()) {
    const hits = await semanticSearch(q, 'all')
    if (hits.length) {
      return hits.slice(0, limit).map((h) => {
        const n = byId.get(h.noteId)
        return {
          noteId: h.noteId,
          title: h.title,
          kind: n ? itemKind(n) : 'file',
          path: n ? folderPath(n, byId) : '',
          snippet: h.snippet,
          terms,
          score: h.score,
          mode: 'semantic' as const
        }
      })
    }
  }

  let extracted = 0
  const scored: LibraryHit[] = []
  const candidates = all
    .filter((n) => n.kind !== 'folder')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  for (const n of candidates) {
    const kind = itemKind(n)
    const cached = cache.get(n.id)
    let text: string | null = null
    if (kind === 'note' || kind === 'text') text = await itemText(n.id, sender)
    else if (cached && cached.updated === n.updated_at) text = cached.text
    else if (kind !== 'image' && extracted < EXTRACT_BUDGET) {
      extracted++
      text = await itemText(n.id, sender)
    } else text = indexedText(n.id)
    const score = keywordScore(text ?? '', n.title, terms)
    if (score > 0)
      scored.push({
        noteId: n.id,
        title: n.title || '无标题',
        kind,
        path: folderPath(n, byId),
        snippet: snippetAround(text || n.title, terms),
        terms,
        score: Math.round(score * 1000) / 1000,
        mode: 'keyword'
      })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
