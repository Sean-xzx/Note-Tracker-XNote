import type { KeyboardEvent } from 'react'

const INDENT = '    '

/**
 * Tab / Shift+Tab inside a plain-text editor (textarea), four spaces per step:
 * a caret or single-line selection gets four spaces inserted; a multi-line
 * selection indents every line; Shift+Tab removes up to four leading spaces
 * (or one tab) per line. Goes through insertText so native undo keeps working.
 * Returns true when the key was handled.
 */
export function handleTextareaTab(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.nativeEvent.isComposing) return false
  const ta = e.currentTarget
  if (ta.readOnly) return false
  e.preventDefault()
  const v = ta.value
  const { selectionStart: s, selectionEnd: t } = ta
  const multi = v.slice(s, t).includes('\n')
  if (!e.shiftKey && !multi) {
    document.execCommand('insertText', false, INDENT)
    return true
  }
  // whole lines touched by the selection
  const from = v.lastIndexOf('\n', s - 1) + 1
  let to = v.indexOf('\n', t > s && v[t - 1] === '\n' ? t - 1 : t)
  if (to < 0) to = v.length
  const lines = v.slice(from, to).split('\n')
  const out = lines.map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : INDENT + l))
  const block = out.join('\n')
  if (block === v.slice(from, to)) return true
  const firstDelta = out[0].length - lines[0].length
  ta.setSelectionRange(from, to)
  document.execCommand('insertText', false, block)
  // keep the same lines selected (a caret stays a caret, shifted with its line)
  const ns = Math.max(from, s + firstDelta)
  ta.setSelectionRange(ns, s === t ? ns : from + block.length)
  return true
}
