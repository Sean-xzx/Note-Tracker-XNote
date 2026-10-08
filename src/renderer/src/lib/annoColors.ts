// Annotation color system. A stored color is EITHER a semantic preset token
// ('yellow'|'green'|…, mapped to :root CSS vars so dark mode can override) OR a
// raw hex string ('#rrggbb', from the custom color picker). `resolveColor`
// turns either into a { bg (translucent fill), line (solid) } pair.

export interface AnnoColor {
  token: string
  label: string
  bg: string // var(--anno-<token>-bg)
  line: string // var(--anno-<token>-line)
}

export const ANNO_COLORS: AnnoColor[] = [
  { token: 'yellow', label: '重点', bg: 'var(--anno-yellow-bg)', line: 'var(--anno-yellow-line)' },
  { token: 'green', label: '已懂', bg: 'var(--anno-green-bg)', line: 'var(--anno-green-line)' },
  { token: 'red', label: '疑问', bg: 'var(--anno-red-bg)', line: 'var(--anno-red-line)' },
  { token: 'blue', label: '待查', bg: 'var(--anno-blue-bg)', line: 'var(--anno-blue-line)' },
  { token: 'purple', label: '灵感', bg: 'var(--anno-purple-bg)', line: 'var(--anno-purple-line)' }
]

/** Solid hex for each preset token, so custom pickers can seed from a preset. */
export const PRESET_HEX: Record<string, string> = {
  yellow: '#e7b23a',
  green: '#4e9d55',
  red: '#c25236',
  blue: '#4b74c4',
  purple: '#8a5cc0'
}

export function colorByToken(token: string): AnnoColor {
  return ANNO_COLORS.find((c) => c.token === token) ?? ANNO_COLORS[0]
}

export function isHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)
}

/** '#rgb' | '#rrggbb' → {r,g,b} (0..255). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Resolve a stored color (token or hex) into a fill + line pair for CSS vars. */
export function resolveColor(color: string): { bg: string; line: string } {
  if (isHex(color)) return { bg: hexToRgba(color, 0.4), line: color }
  const c = colorByToken(color)
  return { bg: c.bg, line: c.line }
}

// ---- HSV <-> hex (for the custom picker) ----------------------------------
export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

// ---- recent colors (localStorage) -----------------------------------------
// Recorded ONLY when a color is actually used to create an annotation/stroke
// (never while dragging in the picker). De-duplicated, newest first, max 8.
const RECENT_KEY = 'xnote.anno.recentColors'
const RECENT_MAX = 8

/** A storable color: a preset token or a #hex. */
export const isColorValue = (v: string): boolean => isHex(v) || v in PRESET_HEX
/** Solid swatch color for any stored value. */
export const swatchOf = (v: string): string => (isHex(v) ? v : colorByToken(v).line)

export function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw) return (JSON.parse(raw) as string[]).filter(isColorValue).slice(0, RECENT_MAX)
  } catch {
    /* ignore */
  }
  return []
}
export function pushRecentColor(color: string): string[] {
  if (!isColorValue(color)) return loadRecentColors()
  const key = color.toLowerCase()
  const next = [color, ...loadRecentColors().filter((c) => c.toLowerCase() !== key)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}
