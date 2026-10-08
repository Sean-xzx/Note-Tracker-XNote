import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import DOMPurify from 'dompurify'
import { Check, Copy } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { prepareMarkdown, hastText } from '../lib/chatMarkdown'
import { parseImageAlt } from '../lib/md/imageSize'
import { ICON } from './ui'

// Sanitise the *model's* Markdown first (no raw HTML is ever rendered; only the
// classes remark-math / fenced code need survive). KaTeX and highlight.js run
// afterwards on the clean tree, so their own markup is trusted output.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']]
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* clipboard unavailable — nothing sensible to do */
  }
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }): JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <button
      className="code-copy"
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check size={ICON.xxs} strokeWidth={ICON.stroke} /> : <Copy size={ICON.xxs} strokeWidth={ICON.stroke} />}
      {done ? '已复制' : label}
    </button>
  )
}

/** Mermaid diagram — loaded on demand, sanitised, falls back to the source. */
function MermaidBlock({ code, fallback }: { code: string; fallback: ReactNode }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit', htmlLabels: false, flowchart: { htmlLabels: false } })
        const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, code)
        if (alive) setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }))
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [code])
  if (failed) return <>{fallback}</>
  if (!svg) return <div className="mermaid-block loading">正在绘制图表…</div>
  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
}

interface Props {
  content: string
  streaming: boolean
  /** Click on a [n] citation chip. */
  onCite?: (n: number) => void
}

/** Assistant answer rendered like the reading view (Claude-style, no bubble). */
export const ChatMarkdown = memo(function ChatMarkdown({ content, streaming, onCite }: Props): JSX.Element {
  const md = useMemo(() => prepareMarkdown(content, streaming), [content, streaming])
  const citeRef = useRef(onCite)
  citeRef.current = onCite

  const components = useMemo<Components>(
    () => ({
      pre({ node, children }) {
        const codeEl = (node?.children?.[0] ?? null) as { properties?: { className?: string[] } } | null
        const cls = codeEl?.properties?.className ?? []
        const lang = cls.find((c) => c.startsWith('language-'))?.slice(9) ?? ''
        const raw = hastText(node).replace(/\n$/, '')
        const block = (
          <div className="code-block">
            <div className="code-head">
              <span className="code-lang">{lang || 'text'}</span>
              <CopyButton text={raw} />
            </div>
            <pre>{children}</pre>
          </div>
        )
        if (lang === 'mermaid' && !streaming) return <MermaidBlock code={raw} fallback={block} />
        return block
      },
      a({ href, children }) {
        const cite = /^#cite-(\d+)$/.exec(href ?? '')
        if (cite)
          return (
            <button className="cite-chip" onClick={() => citeRef.current?.(+cite[1])} title={`来源 ${cite[1]}`}>
              {cite[1]}
            </button>
          )
        const external = /^https?:\/\//i.test(href ?? '')
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              if (external && href) window.api.app.openExternal(href)
            }}
            title={href}
          >
            {children}
          </a>
        )
      },
      img({ src, alt }) {
        // ![说明|400](src): same width syntax as the note editor
        const { alt: caption, width } = parseImageAlt(alt ?? '')
        return <img src={src} alt={caption} style={width ? { width } : undefined} />
      },
      table({ children }) {
        return (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        )
      }
    }),
    [streaming]
  )

  return (
    <div className="chat-md">
      <Markdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeSanitize, schema], [rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {md}
      </Markdown>
    </div>
  )
})

export { copyText }
