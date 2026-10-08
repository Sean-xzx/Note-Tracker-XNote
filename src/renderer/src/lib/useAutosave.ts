import { useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved'

const AUTOSAVE_MS = 1200

/**
 * Debounced autosave for a text document identified by `id`. Loads on id change,
 * saves ~1.2s after the last edit, shows a save status, and flushes any pending
 * edit when the id changes or the component unmounts (so nothing is lost on
 * switch). `load`/`save` are read through refs so changing their identity does
 * not re-trigger a reload.
 */
export function useAutosave(opts: {
  id: string
  load: (id: string) => Promise<string>
  save: (id: string, content: string) => Promise<unknown>
  onSaved?: () => void
}): { content: string; status: SaveStatus; onChange: (v: string) => void } {
  const { id } = opts
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')

  const contentRef = useRef('')
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadRef = useRef(opts.load)
  const saveRef = useRef(opts.save)
  const savedRef = useRef(opts.onSaved)
  loadRef.current = opts.load
  saveRef.current = opts.save
  savedRef.current = opts.onSaved

  useEffect(() => {
    let cancelled = false
    const leavingId = id
    setStatus('idle')

    loadRef.current(id).then((text) => {
      if (cancelled) return
      setContent(text)
      contentRef.current = text
      dirtyRef.current = false
    })

    return () => {
      cancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (dirtyRef.current) {
        saveRef.current(leavingId, contentRef.current).then(() => savedRef.current?.())
        dirtyRef.current = false
      }
    }
  }, [id])

  function onChange(value: string): void {
    setContent(value)
    contentRef.current = value
    dirtyRef.current = true
    setStatus('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      timerRef.current = null
      await saveRef.current(id, contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      savedRef.current?.()
    }, AUTOSAVE_MS)
  }

  return { content, status, onChange }
}
