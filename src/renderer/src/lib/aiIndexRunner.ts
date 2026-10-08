import { extractText } from './aiExtract'

export interface IndexProgress {
  done: number
  total: number
  label: string
}
export interface IndexSummary {
  indexed: number
  skipped: number
  errors: number
  total: number
}

/**
 * Reindex the library. Incremental by default (only new/changed items, decided
 * by the main process from indexed_at vs updated_at); `force` re-embeds all.
 * Runs in the renderer (extraction) + main (embed/store); progress is reported.
 */
export async function reindex(
  onProgress: (p: IndexProgress) => void,
  force = false
): Promise<IndexSummary> {
  const items = (await window.api.tree.list()).filter((i) => i.kind !== 'folder')
  const plan = await window.api.ai.indexPlan(items.map((n) => ({ id: n.id, updated_at: n.updated_at })))
  const toIndex = force ? items.map((n) => n.id) : plan.toIndex
  const total = toIndex.length

  let done = 0
  let indexed = 0
  let skipped = force ? 0 : plan.upToDate
  let errors = 0

  for (const id of toIndex) {
    const note = items.find((n) => n.id === id)
    if (!note) {
      done++
      continue
    }
    onProgress({ done, total, label: note.title })
    try {
      const text = await extractText(note)
      const r = await window.api.ai.indexNote(id, text)
      if (r.status === 'error') errors++
      else if (r.status === 'skipped') skipped++
      else indexed++
    } catch {
      errors++
    }
    done++
    onProgress({ done, total, label: note.title })
  }
  return { indexed, skipped, errors, total }
}
