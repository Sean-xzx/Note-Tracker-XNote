import { app } from 'electron'
import { join, extname, basename } from 'path'
import {
  mkdirSync,
  copyFileSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync
} from 'fs'
import { randomUUID, randomBytes } from 'crypto'

// The file library: uploaded (kind='file') items keep their bytes under
// userData/files as <uuid><ext>. Only metadata lives in the notes table.

/** Directory holding library file bytes, created on first use. */
export function filesDir(): string {
  const dir = join(app.getPath('userData'), 'files')
  mkdirSync(dir, { recursive: true })
  return dir
}

// Best-effort MIME by extension — drives viewer choice, not an upload gate.
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

export function guessMime(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null
}

/** Filename without its extension (used as a file item's default title). */
export function fileNameWithoutExt(name: string): string {
  const b = basename(name)
  const e = extname(b)
  return e ? b.slice(0, -e.length) : b
}

export interface StoredFile {
  stored_name: string
  original_name: string
  mime_type: string | null
  size_bytes: number
}

/** Copy an external file into the library store. */
export function storeFile(srcPath: string): StoredFile {
  const original = basename(srcPath)
  const ext = extname(srcPath)
  const stored = `${randomUUID()}${ext}`
  const dest = join(filesDir(), stored)
  copyFileSync(srcPath, dest)
  return {
    stored_name: stored,
    original_name: original,
    mime_type: guessMime(ext),
    size_bytes: statSync(dest).size
  }
}

/** Absolute path to a stored file. */
export function storedFilePath(stored_name: string): string {
  return join(filesDir(), stored_name)
}

/** Read a stored file's bytes (for pdf.js / mammoth / SheetJS viewers). */
export function readStoredBytes(stored_name: string): Uint8Array {
  return new Uint8Array(readFileSync(storedFilePath(stored_name)))
}

/** Atomically overwrite a stored text file (for editable text file items). */
export function writeStoredFileText(stored_name: string, content: string): void {
  const target = storedFilePath(stored_name)
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, content, 'utf8')
  try {
    renameSync(tmp, target) // atomic on the same volume
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // ignore cleanup failure
    }
    throw err
  }
}

/** Delete a stored file (best-effort; missing file is not an error). */
export function deleteStoredFile(stored_name: string): void {
  try {
    rmSync(storedFilePath(stored_name), { force: true })
  } catch {
    // ignore
  }
}
