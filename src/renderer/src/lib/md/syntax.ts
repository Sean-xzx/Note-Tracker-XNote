import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Tag, tags } from '@lezer/highlight'
import type { MarkdownConfig, BlockContext, Line, InlineContext } from '@lezer/markdown'
import type { Extension } from '@codemirror/state'

// Markdown dialect of the live editor: CommonMark + GFM (tables, task lists,
// strikethrough, autolinks) + ==highlight==, $inline$ and $$display$$ maths.
// The parser only annotates the source; it never rewrites it.

export const markTag = Tag.define()
export const mathTag = Tag.define()

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }
const Punct = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¡-¿‐-‧‰-⁞　-〿＀-／]/

const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': markTag } },
    { name: 'HighlightMark', style: tags.processingInstruction }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        const pBefore = Punct.test(before)
        const pAfter = Punct.test(after)
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter)
        )
      },
      after: 'Emphasis'
    }
  ]
}

/** `$tex$` — no space just inside the dollars, closing `$` not followed by a digit. */
const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: mathTag },
    { name: 'InlineMathMark', style: tags.processingInstruction }
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 36 /* $ */ || cx.char(pos + 1) === 36) return -1
        const first = cx.char(pos + 1)
        if (first === 32 || first === 9 || first === 10 || first === -1) return -1
        for (let i = pos + 1; i < cx.end; i++) {
          const c = cx.char(i)
          if (c === 92 /* \ */) {
            i++
            continue
          }
          if (c === 10) return -1
          if (c === 36) {
            const prev = cx.char(i - 1)
            const after = cx.char(i + 1)
            if (i === pos + 1 || prev === 32 || prev === 9 || (after >= 48 && after <= 57)) return -1
            return cx.addElement(
              cx.elt('InlineMath', pos, i + 1, [cx.elt('InlineMathMark', pos, pos + 1), cx.elt('InlineMathMark', i, i + 1)])
            )
          }
        }
        return -1
      },
      before: 'Emphasis'
    }
  ]
}

const isMathFence = (line: Line): boolean =>
  line.next === 36 && line.text.charCodeAt(line.pos + 1) === 36 && line.indent < 4

/** `$$` … `$$` on its own lines (or `$$ tex $$` on one line). */
const BlockMath: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true, style: mathTag },
    { name: 'BlockMathMark', style: tags.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx: BlockContext, line: Line) {
        if (!isMathFence(line)) return false
        const from = cx.lineStart + line.pos
        const marks = [cx.elt('BlockMathMark', from, from + 2)]
        const rest = line.text.slice(line.pos + 2)
        const close = rest.lastIndexOf('$$')
        if (close >= 0 && rest.slice(close + 2).trim() === '' && rest.slice(0, close).trim() !== '') {
          const at = from + 2 + close
          marks.push(cx.elt('BlockMathMark', at, at + 2))
          cx.nextLine()
          cx.addElement(cx.elt('BlockMath', from, at + 2, marks))
          return true
        }
        let end = cx.lineStart + line.text.length
        while (cx.nextLine()) {
          // stop when the enclosing quote / list ends (same test FencedCode uses; not in the public typings)
          if ((line as unknown as { depth: number }).depth < (cx as unknown as { stack: unknown[] }).stack.length) break
          end = cx.lineStart + line.text.length
          const idx = line.text.indexOf('$$', line.pos)
          if (idx >= 0 && line.text.slice(idx + 2).trim() === '') {
            marks.push(cx.elt('BlockMathMark', cx.lineStart + idx, cx.lineStart + idx + 2))
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('BlockMath', from, end, marks))
        return true
      },
      endLeaf: (_cx: BlockContext, line: Line) => isMathFence(line),
      before: 'FencedCode'
    }
  ]
}

export const markdownExtensions: MarkdownConfig[] = [Highlight, InlineMath, BlockMath]

/** The CodeMirror language support for notes (keymap added separately). */
export function markdownSupport(): Extension {
  return markdown({ base: markdownLanguage, extensions: markdownExtensions, addKeymap: false, completeHTMLTags: false })
}
