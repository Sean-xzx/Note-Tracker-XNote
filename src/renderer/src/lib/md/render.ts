import katex from 'katex'
import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { createLowlight, common } from 'lowlight'

// Rendering helpers for the live editor's widgets. Everything is local and
// every piece of HTML that did not come from KaTeX / lowlight is sanitised.

// ---- KaTeX -------------------------------------------------------------------
export interface MathResult {
  html: string | null
  error: string | null
}
const mathCache = new Map<string, MathResult>()

export function renderMath(tex: string, display: boolean): MathResult {
  const key = (display ? 'D' : 'I') + tex
  const hit = mathCache.get(key)
  if (hit) return hit
  let res: MathResult
  try {
    res = { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'htmlAndMathml' }), error: null }
  } catch (e) {
    res = { html: null, error: e instanceof Error ? e.message.replace(/^KaTeX parse error:\s*/, '') : String(e) }
  }
  if (mathCache.size > 500) mathCache.clear()
  mathCache.set(key, res)
  return res
}

// ---- code highlighting (same highlight.js grammar + classes as the AI chat) ----
const lowlight = createLowlight(common)
const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', html: 'xml' }

export interface CodeToken {
  from: number
  to: number
  cls: string
}
const codeCache = new Map<string, CodeToken[]>()

interface HastNode {
  type: string
  value?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

/** Token ranges (relative to `code`) with hljs class names; [] for unknown languages. */
export function highlightCode(code: string, lang: string): CodeToken[] {
  const l = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()
  if (!l || !lowlight.registered(l)) return []
  const key = l + '\u0000' + code
  const hit = codeCache.get(key)
  if (hit) return hit
  const out: CodeToken[] = []
  let pos = 0
  const walk = (n: HastNode, cls: string): void => {
    if (n.type === 'text') {
      const len = n.value?.length ?? 0
      if (cls && len) out.push({ from: pos, to: pos + len, cls })
      pos += len
      return
    }
    const own = n.properties?.className?.join(' ') ?? ''
    const next = own ? (cls ? `${cls} ${own}` : own) : cls
    for (const c of n.children ?? []) walk(c, next)
  }
  try {
    walk(lowlight.highlight(l, code) as unknown as HastNode, '')
  } catch {
    return []
  }
  if (codeCache.size > 300) codeCache.clear()
  codeCache.set(key, out)
  return out
}

// ---- inline markdown (table cells) ---------------------------------------------
export function inlineHtml(md: string): string {
  const withMath = md.replace(/(^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$(?!\d)/g, (_m, pre: string, tex: string) => {
    const r = renderMath(tex, false)
    return pre + (r.html ? `<span data-katex="${encodeURIComponent(tex)}"></span>` : `$${tex}$`)
  })
  const html = DOMPurify.sanitize(marked.parseInline(withMath.replace(/==([^=]+)==/g, '<mark>$1</mark>'), { async: false }) as string)
  // KaTeX output is trusted markup; splice it in after sanitising the rest
  return html.replace(/<span data-katex="([^"]*)"><\/span>/g, (_m, t: string) => renderMath(decodeURIComponent(t), false).html ?? '')
}

// ---- mermaid -------------------------------------------------------------------
const mermaidCache = new Map<string, Promise<string>>()
export function renderMermaid(code: string): Promise<string> {
  let p = mermaidCache.get(code)
  if (!p) {
    p = (async () => {
      const mermaid = (await import('mermaid')).default
      // SVG text labels: HTML labels live in <foreignObject>, which sanitising removes
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit', htmlLabels: false, flowchart: { htmlLabels: false } })
      const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, code)
      return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
    })()
    p.catch(() => mermaidCache.delete(code))
    mermaidCache.set(code, p)
  }
  return p
}

// ---- image sources -------------------------------------------------------------
/** Map a markdown image URL to something the renderer may load (or null). */
export function resolveImageSrc(raw: string): string | null {
  const src = raw.trim().replace(/^<|>$/g, '')
  if (/^(https?:|data:image\/|xnote-file:|blob:)/i.test(src)) return src
  let path: string | null = null
  if (/^file:\/\//i.test(src)) {
    try {
      path = decodeURIComponent(new URL(src).pathname).replace(/^\/([a-zA-Z]:)/, '$1')
    } catch {
      path = null
    }
  } else if (/^[a-zA-Z]:[\\/]/.test(src) || /^\\\\/.test(src)) {
    path = src
  }
  if (path) return `xnote-local://img/${encodeURIComponent(path.replace(/\\/g, '/'))}`
  return null
}
