import type { AnnoType } from '../../../preload'

// Remember the user's last-used tool and color.
const TOOL_KEY = 'xnote.anno.tool'
const COLOR_KEY = 'xnote.anno.color'

export type Tool = Extract<AnnoType, 'highlight' | 'underline' | 'wavy' | 'comment'>

export function loadTool(): Tool {
  const t = localStorage.getItem(TOOL_KEY)
  return t === 'underline' || t === 'wavy' || t === 'comment' ? t : 'highlight'
}
export function saveTool(t: Tool): void {
  try {
    localStorage.setItem(TOOL_KEY, t)
  } catch {
    /* ignore */
  }
}
export function loadColor(): string {
  return localStorage.getItem(COLOR_KEY) || 'yellow'
}
export function saveColor(c: string): void {
  try {
    localStorage.setItem(COLOR_KEY, c)
  } catch {
    /* ignore */
  }
}

/** Compact relative-time label ("划于 3 天前"). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.floor((Date.now() - then) / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}
