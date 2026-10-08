import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'fs'
import { randomBytes } from 'crypto'

// The markdown body of every note lives on disk as `<id>.md` under the
// user-data dir, kept in sync with the SQLite metadata row. Using the note's
// id as the filename sidesteps title collisions and illegal-character issues.

/** Absolute path to the notes directory, created on first use. */
export function notesDir(): string {
  const dir = join(app.getPath('userData'), 'notes')
  mkdirSync(dir, { recursive: true }) // no-op if it already exists
  return dir
}

/**
 * The stored filename for a note (relative to notesDir). This — not an absolute
 * path — is what we persist in `notes.file_path`, so the data stays portable
 * across machines/OS user-data locations.
 */
export function noteFileName(id: string): string {
  return `${id}.md`
}

/** Absolute path to a single note's markdown file (notesDir + filename). */
export function noteFilePath(id: string): string {
  return join(notesDir(), noteFileName(id))
}

/**
 * Atomically write a note's markdown. We write to a uniquely-named temp file in
 * the same directory, then rename it over the target. rename is atomic on the
 * same volume, so a crash mid-write leaves the previous file intact rather than
 * a half-written one. Returns the final path (for storing in `file_path`).
 */
export function writeNoteFile(id: string, content: string | Buffer): string {
  const target = noteFilePath(id)
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  if (typeof content === 'string') writeFileSync(tmp, content, 'utf8')
  else writeFileSync(tmp, content) // raw bytes: an uploaded .md is kept byte-for-byte
  try {
    renameSync(tmp, target)
  } catch (err) {
    // Rename failed — don't leave the temp file lying around, then surface it.
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best-effort cleanup; ignore
    }
    throw err
  }
  return target
}

/**
 * Read a note's markdown body. Returns null when the file is missing (e.g. it
 * was deleted out from under us), so callers can degrade gracefully instead of
 * crashing. Any other I/O error is thrown.
 */
export function readNoteFile(id: string): string | null {
  try {
    return readFileSync(noteFilePath(id), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Delete a note's markdown file. A missing file is not an error. */
export function deleteNoteFile(id: string): void {
  rmSync(noteFilePath(id), { force: true }) // force => no throw when absent
}

/** Raw bytes of a note's file (null when missing). */
export function readNoteBytes(id: string): Buffer | null {
  try {
    return readFileSync(noteFilePath(id))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

/** Byte offset in `raw` where `str.slice(0, idx)` ends (raw decodes to str). */
function byteOffset(raw: Buffer, str: string, idx: number): number {
  const pre = str.slice(0, idx)
  const post = str.slice(idx)
  const est = Buffer.byteLength(pre, 'utf8')
  const bad = pre.split('�').length - 1
  for (let k = Math.max(0, est - 3 * bad - 4); k <= Math.min(raw.length, est + 4); k++) {
    if (raw.subarray(0, k).toString('utf8') === pre && raw.subarray(k).toString('utf8') === post) return k
  }
  return -1
}

/**
 * For a file whose bytes are not plain UTF-8 (the editor only ever sees the
 * decoded text, with U+FFFD for undecodable bytes): write the changed span
 * only, keeping every other original byte. Returns null if it cannot map the
 * change back onto the bytes.
 */
export function spliceBytes(raw: Buffer, oldStr: string, newStr: string): Buffer | null {
  const max = Math.min(oldStr.length, newStr.length)
  let p = 0
  while (p < max && oldStr.charCodeAt(p) === newStr.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && oldStr.charCodeAt(oldStr.length - 1 - s) === newStr.charCodeAt(newStr.length - 1 - s)) s++
  // never cut a surrogate pair in two
  while (p > 0 && isHigh(oldStr.charCodeAt(p - 1))) p--
  while (s > 0 && isLow(oldStr.charCodeAt(oldStr.length - s))) s--
  const a = byteOffset(raw, oldStr, p)
  const b = byteOffset(raw, oldStr, oldStr.length - s)
  if (a < 0 || b < a) return null
  return Buffer.concat([raw.subarray(0, a), Buffer.from(newStr.slice(p, newStr.length - s), 'utf8'), raw.subarray(b)])
}
