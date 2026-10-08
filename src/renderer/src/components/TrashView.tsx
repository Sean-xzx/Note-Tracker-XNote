import { useCallback, useEffect, useState } from 'react'
import type { Note } from '../../../preload'
import { ArrowLeft, Trash2, RotateCcw, X } from 'lucide-react'
import { FileKindIcon } from '../lib/fileIcon'
import { EmptyState, IconButton, confirmDialog, ICON } from './ui'
import { formatWhen } from '../lib/format'

/** Recycle-bin panel shown in the main area. Restore / permanently delete. */
export function TrashView({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }): JSX.Element {
  const [items, setItems] = useState<Note[]>([])

  const reload = useCallback(async () => {
    setItems(await window.api.tree.listTrash())
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  async function restore(id: string): Promise<void> {
    await window.api.tree.restore(id)
    await reload()
    onChanged()
  }
  async function permanently(id: string): Promise<void> {
    if (!(await confirmDialog({ title: '永久删除', message: '永久删除该条目?此操作不可撤销,实际文件也会被删除。', confirmLabel: '永久删除', danger: true })))
      return
    await window.api.tree.permanentlyDelete(id)
    await reload()
    onChanged()
  }
  async function empty(): Promise<void> {
    if (items.length === 0) return
    if (!(await confirmDialog({ title: '清空回收站', message: '其中所有内容将被永久删除,不可撤销。', confirmLabel: '清空', danger: true })))
      return
    await window.api.tree.emptyTrash()
    await reload()
    onChanged()
  }

  return (
    <>
      <div className="editor-header">
        <div className="eh-title">
          <IconButton icon={ArrowLeft} label="返回文件库" onClick={onClose} />
          <span className="doc-title">回收站</span>
        </div>
        <div className="header-right">
          <button className="btn btn-secondary btn-sm" disabled={items.length === 0} onClick={empty}>
            清空回收站
          </button>
        </div>
      </div>
      <div className="editor-body trash-body">
        {items.length === 0 ? (
          <EmptyState icon={Trash2} title="回收站是空的" hint="删除的条目会先移到这里,可以恢复或永久删除" />
        ) : (
          <ul className="trash-list">
            {items.map((it) => (
              <li className="trash-item" key={it.id}>
                <span className="tree-icon"><FileKindIcon note={it} /></span>
                <div className="trash-meta">
                  <div className="trash-name">{it.title || '无标题'}</div>
                  <div className="trash-sub">
                    {it.kind === 'folder' ? '文件夹 · ' : ''}
                    删除于 {it.deleted_at ? formatWhen(it.deleted_at) : ''}
                  </div>
                </div>
                <div className="trash-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => restore(it.id)}>
                    <RotateCcw size={ICON.xs} strokeWidth={ICON.stroke} />
                    恢复
                  </button>
                  <IconButton icon={X} small className="danger" label="永久删除" onClick={() => permanently(it.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
