import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Note } from '../../../preload'

/** Editable title field for a file item (metadata stays editable for all files). */
export function FileTitleInput({
  note,
  onSaved
}: {
  note: Note
  onSaved: () => void
}): JSX.Element {
  const [title, setTitle] = useState(note.title)
  useEffect(() => setTitle(note.title), [note.id, note.title])

  async function save(): Promise<void> {
    const next = title.trim() || note.original_name || '无标题'
    if (next !== note.title) {
      await window.api.notes.update(note.id, { title: next })
      onSaved()
    }
  }

  return (
    <input
      className="file-title-input"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      spellCheck={false}
    />
  )
}
