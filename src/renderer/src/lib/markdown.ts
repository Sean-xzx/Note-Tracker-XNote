import { marked } from 'marked'
import DOMPurify from 'dompurify'

// GitHub-flavored markdown, single newlines become <br>. Rendering happens
// entirely locally; output is sanitized before it ever touches innerHTML.
marked.setOptions({ gfm: true, breaks: true })

/** Render markdown to sanitized HTML safe for dangerouslySetInnerHTML. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string
  return DOMPurify.sanitize(html)
}
