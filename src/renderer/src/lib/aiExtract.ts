import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import type { Note } from '../../../preload'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'xml', 'yml', 'yaml', 'ini', 'js', 'ts',
  'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php',
  'sh', 'html', 'css', 'json', 'csv'
])

/**
 * Extract plain text from any library item for indexing (reuses the Step-1
 * parsers). Images are read by a vision model (DeepSeek/OpenAI/Google) so their
 * content becomes searchable; on failure we fall back to the title.
 */
export async function extractText(note: Note): Promise<string> {
  if (note.kind === 'folder') return note.title
  if (note.kind === 'markdown') {
    const c = await window.api.notes.getContent(note.id)
    return c?.content ?? note.title
  }

  const mime = note.mime_type ?? ''
  const ext = (note.original_name?.split('.').pop() ?? '').toLowerCase()
  if (mime.startsWith('image/')) {
    try {
      const desc = await window.api.ai.describeImage(note.id)
      return desc ? `${note.title}\n${desc}` : note.title
    } catch {
      return note.title // vision unavailable → still findable by title
    }
  }

  const bytes = await window.api.files.getBytes(note.id)
  if (!bytes) return note.title

  try {
    if (mime === 'application/pdf' || ext === 'pdf') {
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
      let out = ''
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p)
        const tc = await page.getTextContent()
        out += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
      }
      return out
    }
    if (ext === 'docx' || mime.includes('wordprocessingml')) {
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const r = await mammoth.extractRawText({ arrayBuffer: ab })
      return r.value
    }
    if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('spreadsheet') || mime === 'text/csv') {
      const wb =
        ext === 'csv' || mime === 'text/csv'
          ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string' })
          : XLSX.read(bytes, { type: 'array' })
      return wb.SheetNames.map((n) => `# ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n')
    }
    if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTS.has(ext)) {
      return new TextDecoder('utf-8').decode(bytes)
    }
  } catch {
    // parsing failed — fall back to the title so the item is still findable
  }
  return note.title
}
