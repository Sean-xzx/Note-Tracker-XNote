import { EditorSelection, Prec, type Extension, type ChangeSpec } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import { insertNewlineContinueMarkup, deleteMarkupBackward, markdownLanguage } from '@codemirror/lang-markdown'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'

// Editing behaviour of the note editor. Every command is a plain text change
// on the source (so undo / redo and lossless save need nothing special).

/** Wrap / unwrap each selection with `mark` (bold, italic, inline code). */
function toggleWrap(mark: string): Command {
  return (view) => {
    const { state } = view
    if (state.readOnly) return false
    const n = mark.length
    const tr = state.changeByRange((r) => {
      const before = state.sliceDoc(r.from - n, r.from)
      const after = state.sliceDoc(r.to, r.to + n)
      // already wrapped just outside the selection → unwrap
      if (before === mark && after === mark && !(mark === '*' && state.sliceDoc(r.from - 2, r.from) === '**' && state.sliceDoc(r.to, r.to + 2) === '**' && state.sliceDoc(r.from - 3, r.from) !== '***')) {
        return {
          changes: [
            { from: r.from - n, to: r.from },
            { from: r.to, to: r.to + n }
          ],
          range: EditorSelection.range(r.from - n, r.to - n)
        }
      }
      const inner = state.sliceDoc(r.from, r.to)
      if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
        return {
          changes: [
            { from: r.from, to: r.from + n },
            { from: r.to - n, to: r.to }
          ],
          range: EditorSelection.range(r.from, r.to - 2 * n)
        }
      }
      return {
        changes: [
          { from: r.from, insert: mark },
          { from: r.to, insert: mark }
        ],
        range: EditorSelection.range(r.from + n, r.to + n)
      }
    })
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}

/** Ctrl+K: [text](url) — the url placeholder is selected, ready to paste over. */
const insertLink: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const tr = state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to)
    const isUrl = /^https?:\/\/\S+$/.test(text)
    if (isUrl) {
      const insert = `[](${text})`
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + 1) }
    }
    const insert = `[${text}](https://)`
    const urlFrom = r.from + text.length + 3
    return {
      changes: { from: r.from, to: r.to, insert },
      range: text ? EditorSelection.range(urlFrom, urlFrom + 8) : EditorSelection.cursor(r.from + 1)
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

const LINE_PREFIX = /^(\s*(?:>\s?)*)(#{1,6}[ \t]+)?/

/** Ctrl+1…6 set the heading level of the selected lines; Ctrl+0 back to body text. */
function setHeading(level: number): Command {
  return (view) => {
    const { state } = view
    if (state.readOnly) return false
    const changes: ChangeSpec[] = []
    const seen = new Set<number>()
    for (const r of state.selection.ranges) {
      for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) {
        if (seen.has(l)) continue
        seen.add(l)
        const line = state.doc.line(l)
        const m = LINE_PREFIX.exec(line.text)!
        const at = line.from + m[1].length
        const old = m[2] ?? ''
        const want = level > 0 ? '#'.repeat(level) + ' ' : ''
        if (old !== want) changes.push({ from: at, to: at + old.length, insert: want })
      }
    }
    if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
    return true
  }
}

const LIST_LINE = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)/

/** One indentation step everywhere in the editor: four spaces. */
export const INDENT = '    '

/**
 * Tab: with a bare caret outside a list item, four spaces are inserted at the
 * caret; on list items or over a selection, every touched line moves one level
 * (4 spaces) in. Shift+Tab takes up to four leading spaces (or one tab) off each
 * line. Tab characters already in the file are never rewritten.
 */
function tabIndent(dir: 1 | -1): Command {
  return (view) => {
    const { state } = view
    if (state.readOnly) return false
    const lines = new Set<number>()
    for (const r of state.selection.ranges)
      for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l)
    const all = [...lines]
    const caretOnly = state.selection.ranges.every((r) => r.empty)
    const onList = all.every((l) => LIST_LINE.test(state.doc.line(l).text))
    if (dir === 1 && caretOnly && !onList) {
      view.dispatch(state.replaceSelection(INDENT), { userEvent: 'input.indent', scrollIntoView: true })
      return true
    }
    const changes: ChangeSpec[] = []
    for (const l of all) {
      const line = state.doc.line(l)
      if (dir === 1) changes.push({ from: line.from, insert: INDENT })
      else {
        const lead = /^( {1,4}|\t)/.exec(line.text)
        if (lead) changes.push({ from: line.from, to: line.from + lead[1].length })
      }
    }
    if (changes.length) view.dispatch({ changes, userEvent: dir === 1 ? 'input.indent' : 'delete.dedent' })
    return true
  }
}

/**
 * `*` / `` ` `` typed over a selection wrap it; `**` pairs itself
 * (typing the second star inside a word run gives **|**).
 */
const wrapInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.readOnly || (text !== '*' && text !== '`')) return false
  const { state } = view
  const sel = state.selection
  if (sel.ranges.some((r) => !r.empty)) {
    view.dispatch(
      state.changeByRange((r) => ({
        changes: [
          { from: r.from, insert: text },
          { from: r.to, insert: text }
        ],
        range: EditorSelection.range(r.from + 1, r.to + 1)
      })),
      { userEvent: 'input.format' }
    )
    return true
  }
  if (text !== '*') return false
  if (from !== to || sel.ranges.length > 1) return false
  const prev = state.sliceDoc(from - 1, from)
  const next = state.sliceDoc(from, from + 1)
  // at the end of a word, step over a closing star instead of adding one
  if (next === '*' && prev !== '' && !/\s/.test(prev)) {
    view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'input.type' })
    return true
  }
  // the second star of ** opens a pair: **|**
  if (prev === '*' && state.sliceDoc(from - 2, from - 1) !== '*') {
    view.dispatch({ changes: { from, insert: '***' }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
    return true
  }
  return false
})

export interface EditorCommandHooks {
  toggleSource: () => void
  saveNow: () => void
  openReplace: Command
}

export function markdownEditing(hooks: EditorCommandHooks): Extension {
  return [
    closeBrackets(),
    markdownLanguage.data.of({ closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] } }),
    wrapInput,
    Prec.high(
      keymap.of([
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-k', run: insertLink },
        { key: 'Mod-Shift-k', run: toggleWrap('`') },
        ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-${n}`, run: setHeading(n) })),
        { key: 'Enter', run: insertNewlineContinueMarkup },
        { key: 'Backspace', run: deleteMarkupBackward },
        { key: 'Tab', run: tabIndent(1) },
        { key: 'Shift-Tab', run: tabIndent(-1) },
        { key: 'Mod-/', run: () => (hooks.toggleSource(), true) },
        { key: 'Mod-s', run: () => (hooks.saveNow(), true), preventDefault: true },
        { key: 'Mod-h', run: hooks.openReplace },
        ...closeBracketsKeymap
      ])
    ),
    Prec.low(
      keymap.of([
        {
          key: 'Escape',
          run: (view) => {
            // leave the text so the document shortcuts (P / H / E) work again
            view.contentDOM.blur()
            return true
          }
        }
      ])
    )
  ]
}
