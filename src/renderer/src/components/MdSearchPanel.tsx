import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ChevronUp, ChevronDown, X, Replace, ReplaceAll, CaseSensitive, Regex, WholeWord, ChevronRight } from 'lucide-react'
import type { EditorView, Panel, ViewUpdate, Command } from '@codemirror/view'
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
  openSearchPanel,
  searchPanelOpen
} from '@codemirror/search'
import { IconButton, ICON } from './ui'

// CodeMirror's find / replace, drawn with the app's own controls. The search
// logic (query state, match highlighting, replace) is CodeMirror's.

const replaceSetters = new WeakMap<EditorView, (v: boolean) => void>()
let openWithReplace = false

/** Ctrl+H: open (or switch) the panel with the replace row shown. */
export const openReplacePanel: Command = (view) => {
  if (view.state.readOnly) return false
  openWithReplace = true
  if (searchPanelOpen(view.state)) replaceSetters.get(view)?.(true)
  openSearchPanel(view)
  openWithReplace = false
  return true
}

function countMatches(view: EditorView, q: SearchQuery): { total: number; current: number } {
  if (!q.valid || !q.search) return { total: 0, current: 0 }
  const cursor = q.getCursor(view.state)
  const sel = view.state.selection.main
  let total = 0
  let current = 0
  for (let r = cursor.next(); !r.done && total < 9999; r = cursor.next()) {
    total++
    if (r.value.from === sel.from && r.value.to === sel.to) current = total
  }
  return { total, current }
}

function SearchUI({ view, version, initialReplace, register }: { view: EditorView; version: number; initialReplace: boolean; register: (set: (v: boolean) => void) => void }): JSX.Element {
  const q = getSearchQuery(view.state)
  const [showReplace, setShowReplace] = useState(initialReplace)
  const [counts, setCounts] = useState({ total: 0, current: 0 })
  const replaceRef = useRef<HTMLInputElement>(null)
  useEffect(() => register(setShowReplace), [register])
  useEffect(() => {
    // counting is cheap but not free on big files: after the input settles
    const t = setTimeout(() => setCounts(countMatches(view, getSearchQuery(view.state))), 60)
    return () => clearTimeout(t)
  }, [view, version])
  useEffect(() => {
    if (showReplace && initialReplace) replaceRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (patch: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>): void => {
    const cur = getSearchQuery(view.state)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: patch.search ?? cur.search,
          replace: patch.replace ?? cur.replace,
          caseSensitive: patch.caseSensitive ?? cur.caseSensitive,
          regexp: patch.regexp ?? cur.regexp,
          wholeWord: patch.wholeWord ?? cur.wholeWord
        })
      )
    })
  }
  const close = (): void => {
    closeSearchPanel(view)
    view.focus()
  }
  const invalid = !!q.search && !q.valid
  const readOnly = view.state.readOnly

  return (
    <div
      className="md-search"
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        } else if (mod && e.key.toLowerCase() === 'h' && !readOnly) {
          // editor keymaps do not reach the panel's inputs
          e.preventDefault()
          setShowReplace(true)
          setTimeout(() => replaceRef.current?.focus(), 0)
        } else if (mod && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          const input = (e.currentTarget as HTMLElement).querySelector('[main-field]') as HTMLInputElement | null
          input?.focus()
          input?.select()
        }
      }}
    >
      {!readOnly && (
        <IconButton
          icon={ChevronRight}
          small
          label={showReplace ? '隐藏替换' : '替换'}
          shortcut="Ctrl+H"
          className={`md-search-twisty${showReplace ? ' open' : ''}`}
          onClick={() => setShowReplace((v) => !v)}
        />
      )}
      <div className="md-search-rows">
        <div className="md-search-row">
          <div className={`md-search-field${invalid ? ' invalid' : ''}`}>
            <input
              main-field="true"
              value={q.search}
              placeholder="查找"
              aria-label="查找"
              spellCheck={false}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.shiftKey ? findPrevious : findNext)(view)
                }
              }}
            />
            <button className={`md-search-opt${q.caseSensitive ? ' on' : ''}`} aria-pressed={q.caseSensitive} title="区分大小写" onClick={() => set({ caseSensitive: !q.caseSensitive })}>
              <CaseSensitive size={ICON.xs} strokeWidth={ICON.stroke} />
            </button>
            <button className={`md-search-opt${q.wholeWord ? ' on' : ''}`} aria-pressed={q.wholeWord} title="全字匹配" onClick={() => set({ wholeWord: !q.wholeWord })}>
              <WholeWord size={ICON.xs} strokeWidth={ICON.stroke} />
            </button>
            <button className={`md-search-opt${q.regexp ? ' on' : ''}`} aria-pressed={q.regexp} title="正则表达式" onClick={() => set({ regexp: !q.regexp })}>
              <Regex size={ICON.xs} strokeWidth={ICON.stroke} />
            </button>
          </div>
          <span className="md-search-count">{invalid ? '无效表达式' : q.search ? (counts.total ? (counts.current ? `${counts.current} / ${counts.total}` : `${counts.total} 处`) : '无结果') : ''}</span>
          <IconButton icon={ChevronUp} small label="上一个" shortcut="Shift+Enter" onClick={() => findPrevious(view)} disabled={!counts.total} />
          <IconButton icon={ChevronDown} small label="下一个" shortcut="Enter" onClick={() => findNext(view)} disabled={!counts.total} />
          <IconButton icon={X} small label="关闭" shortcut="Esc" onClick={close} />
        </div>
        {showReplace && !readOnly && (
          <div className="md-search-row">
            <div className="md-search-field">
              <input
                ref={replaceRef}
                value={q.replace}
                placeholder="替换为"
                aria-label="替换为"
                spellCheck={false}
                onChange={(e) => set({ replace: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.ctrlKey || e.metaKey) replaceAll(view)
                    else replaceNext(view)
                  }
                }}
              />
            </div>
            <IconButton icon={Replace} small label="替换" shortcut="Enter" onClick={() => replaceNext(view)} disabled={!counts.total} />
            <IconButton icon={ReplaceAll} small label="全部替换" shortcut="Ctrl+Enter" onClick={() => replaceAll(view)} disabled={!counts.total} />
          </div>
        )}
      </div>
    </div>
  )
}

/** `createPanel` for @codemirror/search. */
export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'md-search-host'
  let root: Root | null = createRoot(dom)
  let version = 0
  const initialReplace = openWithReplace
  const register = (set: (v: boolean) => void): void => {
    replaceSetters.set(view, set)
  }
  const render = (): void => root?.render(<SearchUI view={view} version={version} initialReplace={initialReplace} register={register} />)
  // synchronous first render so CodeMirror can focus [main-field]
  flushSync(render)
  return {
    dom,
    top: true,
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery))) || u.startState.readOnly !== u.state.readOnly) {
        version++
        render()
      }
    },
    destroy() {
      replaceSetters.delete(view)
      const r = root
      root = null
      setTimeout(() => r?.unmount(), 0)
    }
  }
}
