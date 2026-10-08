import {
  Folder,
  FolderOpen,
  NotebookPen,
  FileImage,
  FileText,
  FileType,
  FileSpreadsheet,
  Presentation,
  FileArchive,
  FileCode,
  File
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Note } from '../../../preload'

type Kind = 'folder' | 'markdown' | 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'code' | 'other'

export function kindOf(note: Note): Kind {
  if (note.kind === 'folder') return 'folder'
  if (note.kind === 'markdown') return 'markdown'
  const mime = note.mime_type ?? ''
  const ext = (note.original_name?.split('.').pop() ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'doc'
  if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('spreadsheet')) return 'sheet'
  if (['pptx', 'ppt'].includes(ext) || mime.includes('presentation')) return 'slides'
  if (ext === 'zip' || mime === 'application/zip') return 'archive'
  if (ext === 'json' || mime === 'application/json' || mime.startsWith('text/')) return 'code'
  return 'other'
}

const ICONS: Record<Kind, LucideIcon> = {
  folder: Folder,
  markdown: NotebookPen,
  image: FileImage,
  pdf: FileType,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  code: FileCode,
  other: File
}

/** Line icon for a library item; a muted per-type tint aids scanning. */
export function FileKindIcon({ note, open, size = 16 }: { note: Note; open?: boolean; size?: number }): JSX.Element {
  const kind = kindOf(note)
  const Icon = kind === 'folder' && open ? FolderOpen : ICONS[kind]
  return <Icon size={size} strokeWidth={1.75} className={`kind-icon kind-${kind}`} aria-hidden />
}

/** Same glyphs for a main-process item kind (search results, AI sources). */
const ITEM_KIND: Record<string, Kind> = {
  folder: 'folder',
  note: 'markdown',
  pdf: 'pdf',
  doc: 'doc',
  sheet: 'sheet',
  image: 'image',
  text: 'code',
  file: 'other'
}
export function KindGlyph({ kind, size = 16 }: { kind: string; size?: number }): JSX.Element {
  const k = ITEM_KIND[kind] ?? 'other'
  const Icon = ICONS[k]
  return <Icon size={size} strokeWidth={1.75} className={`kind-icon kind-${k}`} aria-hidden />
}
