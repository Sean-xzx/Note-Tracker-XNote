import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { resolveColor } from '../annoColors'

// Text annotations of a markdown note as mark decorations. Their ranges live in
// the editor state and are mapped through every edit, so a highlight follows
// its words while the user types around (or inside) it.

export interface EditorAnno {
  id: string
  type: string
  color: string
  note: string | null
  from: number
  to: number
  fresh?: boolean
}

export const setAnnos = StateEffect.define<{ annos: EditorAnno[]; activeId: string | null }>()

interface AnnoState {
  set: DecorationSet
  meta: Map<string, EditorAnno>
  activeId: string | null
}

function build(annos: EditorAnno[], activeId: string | null, docLen: number): AnnoState {
  const meta = new Map<string, EditorAnno>()
  const ranges = []
  for (const a of annos) {
    const from = Math.max(0, Math.min(a.from, docLen))
    const to = Math.max(0, Math.min(a.to, docLen))
    if (to <= from) continue
    meta.set(a.id, a)
    const c = resolveColor(a.color)
    const cls = `cm-anno cm-anno-${a.type}${a.id === activeId ? ' active' : ''}${a.fresh ? ' sweep' : ''}`
    const attributes: Record<string, string> = { 'data-anno-id': a.id, style: `--c-bg:${c.bg};--c-line:${c.line}` }
    if (a.type === 'comment' && a.note) attributes.title = a.note
    ranges.push(Decoration.mark({ class: cls, attributes, inclusive: false, annoId: a.id }).range(from, to))
  }
  return { set: Decoration.set(ranges, true), meta, activeId }
}

export const annoField = StateField.define<AnnoState>({
  create: () => ({ set: Decoration.none, meta: new Map(), activeId: null }),
  update(v, tr) {
    let next = tr.docChanged ? { ...v, set: v.set.map(tr.changes) } : v
    for (const e of tr.effects) if (e.is(setAnnos)) next = build(e.value.annos, e.value.activeId, tr.state.doc.length)
    return next
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.set)
})

/** Current (mapped) range of every annotation still present in the document. */
export function annoRanges(state: EditorState): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>()
  const f = state.field(annoField, false)
  if (!f) return out
  f.set.between(0, state.doc.length, (from, to, d) => {
    const id = (d.spec as { annoId?: string }).annoId
    if (id && to > from) {
      const prev = out.get(id)
      out.set(id, prev ? { from: Math.min(prev.from, from), to: Math.max(prev.to, to) } : { from, to })
    }
  })
  return out
}

export function annotations(onClick: (id: string) => void): Extension {
  return [
    annoField,
    EditorView.domEventHandlers({
      click(e) {
        if (e.ctrlKey || e.metaKey) return false
        const el = (e.target as HTMLElement).closest('[data-anno-id]') as HTMLElement | null
        if (el?.dataset.annoId) onClick(el.dataset.annoId)
        return false
      }
    })
  ]
}
