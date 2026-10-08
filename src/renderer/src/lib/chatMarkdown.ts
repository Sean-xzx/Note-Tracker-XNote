/**
 * Pre-processing for assistant Markdown before react-markdown sees it:
 *  - \( … \) and \[ … \] become $ … $ / $$ … $$ (remark-math only knows dollars)
 *  - citations [n] become links (#cite-n) rendered as small numbered chips
 *  - while streaming: an unclosed ``` fence is closed and an unfinished $$ block is
 *    held back, so half-written code/maths never flash or wreck the layout.
 * Code (fenced or inline) is never touched.
 */

interface Segment {
  code: boolean
  text: string
}

/** Split into fenced-code and prose segments (line based, ``` or ~~~ fences). */
function splitFences(md: string): { segments: Segment[]; openFence: string | null } {
  const lines = md.split('\n')
  const segments: Segment[] = []
  let buf: string[] = []
  let fence: string | null = null
  const flush = (code: boolean): void => {
    if (buf.length) segments.push({ code, text: buf.join('\n') })
    buf = []
  }
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (!fence && m) {
      flush(false)
      fence = m[1]
      buf.push(line)
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) {
      buf.push(line)
      flush(true)
      fence = null
    } else buf.push(line)
  }
  flush(fence !== null)
  return { segments, openFence: fence }
}

/** Apply fn to prose outside inline `code` spans. */
function mapOutsideInlineCode(text: string, fn: (s: string) => string): string {
  return text
    .split(/(`+[^`]*`+)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('')
}

function convertDelimiters(s: string): string {
  return (
    s
      .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`)
      // "$$x$$" on one line is display maths too (remark-math would render it inline)
      .replace(/\$\$([^\n$][^$]*?)\$\$/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
  )
}

function linkCitations(s: string): string {
  // [1] / [2][3] — but not markdown links "[x](…)", refs "[x]:" or task boxes "[ ]"
  return s.replace(/\[(\d{1,3})\](?![(:])/g, (_m, n: string) => `[${n}](#cite-${n})`)
}

export function prepareMarkdown(md: string, streaming: boolean): string {
  const { segments, openFence } = splitFences(md)
  let out = segments
    .map((seg) => (seg.code ? seg.text : mapOutsideInlineCode(seg.text, (t) => linkCitations(convertDelimiters(t)))))
    .join('\n')
  if (streaming) {
    if (openFence) out += `\n${openFence}`
    else {
      // hide a display-math block that has started but not finished yet
      const prose = segments.filter((s) => !s.code).map((s) => s.text).join('\n')
      const count = (convertDelimiters(prose).match(/\$\$/g) ?? []).length
      if (count % 2 === 1) {
        const cut = out.lastIndexOf('$$')
        if (cut >= 0) out = out.slice(0, cut)
      }
      // …and a \[ or \( that is still open at the very end
      const open = Math.max(out.lastIndexOf('\\['), out.lastIndexOf('\\('))
      if (open >= 0 && !/\\[\])]/.test(out.slice(open + 2))) out = out.slice(0, open)
    }
  }
  return out
}

/** Plain text of a hast node (for 「复制」 on highlighted code blocks). */
export function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] }
  if (!n) return ''
  if (n.type === 'text') return n.value ?? ''
  return (n.children ?? []).map(hastText).join('')
}
