import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import type { Note } from '../../../preload'
import {
  FilePlus2,
  FolderPlus,
  Upload,
  ChevronsDownUp,
  ChevronRight,
  MoreHorizontal,
  Search,
  FolderOpen,
  Pencil,
  CalendarPlus,
  Trash2,
  NotebookPen,
  Folder,
  Library,
  GraduationCap,
  CalendarX2
} from 'lucide-react'
import { FileKindIcon } from '../lib/fileIcon'
import { IconButton, EmptyState, Collapse, ICON, confirmDialog, promptDialog, Tooltip } from './ui'
import {
  buildTree,
  sortTree,
  filterTree,
  ancestorIds,
  isSelfOrDescendant,
  countTodayDue,
  type SortMode,
  type TreeNode
} from '../lib/tree'
import { TreeContextMenu, type MenuItem } from './TreeContextMenu'

interface Props {
  items: Note[]
  selectedId: string | null
  revealTick: number
  width: number
  onSelect: (id: string) => void
  reload: () => void
}

type Editing =
  | { mode: 'create-note' | 'create-folder'; parentId: string | null }
  | { mode: 'rename'; id: string }
  | null

type DropInfo = { targetId: string | 'root'; pos: 'inside' | 'before' | 'after'; illegal?: boolean } | null

const EXPANDED_KEY = 'xnote.tree.expanded'
const SORT_KEY = 'xnote.tree.sort'
/** Local YYYY-MM-DD, n days from today. */
const localToday = (n = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = (): string => {
  // local calendar date, not the UTC one
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore */
  }
  return new Set()
}
function loadSort(): SortMode {
  const s = localStorage.getItem(SORT_KEY)
  return s === 'name' || s === 'mtime' ? s : 'manual'
}

export function FileTree({ items, selectedId, revealTick, width, onSelect, reload }: Props): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  const [sortMode, setSortMode] = useState<SortMode>(loadSort)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [editValue, setEditValue] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropInfo, setDropInfo] = useState<DropInfo>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const today = todayStr()

  // Review badge sets, derived from the items themselves.
  const scheduledIds = useMemo(
    () => new Set(items.filter((i) => i.due_date !== null).map((i) => i.id)),
    [items]
  )
  const todayDueIds = useMemo(
    () => new Set(items.filter((i) => i.due_date !== null && i.due_date <= today).map((i) => i.id)),
    [items, today]
  )

  // Build + sort + (optionally) filter the tree.
  const { roots, forceExpand, matched } = useMemo(() => {
    const tree = buildTree(items)
    sortTree(tree, sortMode)
    if (query.trim()) {
      const f = filterTree(tree, query)
      return { roots: f.nodes, forceExpand: f.expand, matched: f.matched }
    }
    return { roots: tree, forceExpand: new Set<string>(), matched: new Set<string>() }
  }, [items, sortMode, query])

  const isExpanded = (id: string): boolean => forceExpand.has(id) || expanded.has(id)

  // Persist expanded / sort.
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* ignore */
    }
  }, [expanded])
  useEffect(() => {
    localStorage.setItem(SORT_KEY, sortMode)
  }, [sortMode])

  // Reveal: expand ancestors of the selected item and scroll to it.
  useEffect(() => {
    if (!selectedId) return
    const anc = ancestorIds(items, selectedId)
    if (anc.length) setExpanded((prev) => new Set([...prev, ...anc]))
    requestAnimationFrame(() => {
      rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTick])

  // Flatten visible ids for keyboard navigation.
  const visibleIds = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        out.push(n.note.id)
        if (n.note.kind === 'folder' && n.children.length && isExpanded(n.note.id)) walk(n.children)
      }
    }
    walk(roots)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, expanded, forceExpand])

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function collapseAll(): void {
    setExpanded(new Set())
  }

  // ---- inline create / rename ------------------------------------------------
  function startCreate(mode: 'create-note' | 'create-folder', parentId: string | null): void {
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
    setEditValue(mode === 'create-folder' ? '新建文件夹' : '无标题')
    setEditing({ mode, parentId })
  }
  function startRename(id: string): void {
    const note = byId.get(id)
    if (!note) return
    setEditValue(note.title)
    setEditing({ mode: 'rename', id })
  }
  async function commitEdit(): Promise<void> {
    const name = editValue.trim()
    const cur = editing
    setEditing(null)
    if (!cur || !name) return
    if (cur.mode === 'rename') {
      await window.api.tree.rename(cur.id, name)
      reload()
    } else if (cur.mode === 'create-folder') {
      const f = await window.api.folders.create(name, cur.parentId)
      reload()
      onSelect(f.id)
    } else {
      const n = await window.api.notes.create(name, cur.parentId)
      reload()
      onSelect(n.id)
    }
  }

  // ---- operations ------------------------------------------------------------
  async function upload(parentId: string | null): Promise<void> {
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
    await window.api.files.upload(parentId)
    reload()
  }
  async function softDelete(id: string): Promise<void> {
    await window.api.tree.softDelete(id)
    reload()
  }
  async function addToReview(id: string): Promise<void> {
    await window.api.notes.addToReview(id)
    reload()
  }
  /** 考试日期: reviews of the item (or everything in the folder) land no later than 2 days before it. */
  async function setExam(note: Note): Promise<void> {
    const tomorrow = localToday(1)
    const v = await promptDialog({
      title: '设置考试日期',
      message: `「${note.title}」${note.kind === 'folder' ? '及其中的内容' : ''}的下次复习不会晚于考试前 2 天;考试过后自动恢复正常安排。`,
      defaultValue: note.exam_date && note.exam_date >= tomorrow ? note.exam_date : localToday(30),
      inputType: 'date',
      min: tomorrow,
      confirmLabel: '设置'
    })
    if (v == null || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return
    await window.api.review.setExamDate(note.id, v)
    reload()
  }
  async function clearExam(note: Note): Promise<void> {
    await window.api.review.setExamDate(note.id, null)
    reload()
  }

  // ---- drag & drop -----------------------------------------------------------
  function childrenOf(parentId: string | null): Note[] {
    return items.filter((i) => i.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order)
  }
  function sortInside(parentId: string | null): number {
    const c = childrenOf(parentId)
    return c.length ? c[c.length - 1].sort_order + 1 : 1
  }
  function sortBeforeAfter(target: Note, pos: 'before' | 'after'): { parent: string | null; order: number } {
    const sibs = childrenOf(target.parent_id)
    const idx = sibs.findIndex((s) => s.id === target.id)
    if (pos === 'before') {
      const prev = sibs[idx - 1]
      return { parent: target.parent_id, order: prev ? (prev.sort_order + target.sort_order) / 2 : target.sort_order - 1 }
    }
    const next = sibs[idx + 1]
    return { parent: target.parent_id, order: next ? (target.sort_order + next.sort_order) / 2 : target.sort_order + 1 }
  }

  function computePos(note: Note, e: DragEvent): 'inside' | 'before' | 'after' {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    if (note.kind === 'folder') {
      if (y < rect.height * 0.3) return 'before'
      if (y > rect.height * 0.7) return 'after'
      return 'inside'
    }
    return y < rect.height / 2 ? 'before' : 'after'
  }

  function onRowDragOver(note: Note, e: DragEvent): void {
    e.preventDefault()
    const hasFiles = e.dataTransfer.types.includes('Files')
    let pos = computePos(note, e)
    if (!hasFiles && (sortMode !== 'manual') && pos !== 'inside') {
      // reordering is only allowed in manual mode; still allow drop into folders
      if (note.kind === 'folder') pos = 'inside'
      else {
        setDropInfo({ targetId: note.parent_id ?? 'root', pos: 'inside' })
        return
      }
    }
    if (!hasFiles && draggingId) {
      const targetParent = pos === 'inside' ? note.id : note.parent_id
      const illegal =
        draggingId === note.id ||
        (pos === 'inside' && isSelfOrDescendant(items, draggingId, note.id)) ||
        (targetParent !== null && isSelfOrDescendant(items, draggingId, targetParent))
      setDropInfo({ targetId: note.id, pos, illegal })
      return
    }
    setDropInfo({ targetId: note.id, pos })
  }

  async function onRowDrop(note: Note, e: DragEvent): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    const info = dropInfo
    setDropInfo(null)
    const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0
    if (hasFiles) {
      const parentId = note.kind === 'folder' ? note.id : note.parent_id
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = window.api.files.pathForFile(f)
        if (p) await window.api.files.add(p, parentId)
      }
      if (note.kind === 'folder') setExpanded((prev) => new Set(prev).add(note.id))
      reload()
      return
    }
    const dragId = draggingId
    setDraggingId(null)
    if (!dragId || !info || info.illegal) return
    if (info.pos === 'inside' && note.kind === 'folder') {
      await window.api.tree.move(dragId, note.id, sortInside(note.id))
      setExpanded((prev) => new Set(prev).add(note.id))
    } else {
      const { parent, order } = sortBeforeAfter(note, info.pos === 'before' ? 'before' : 'after')
      await window.api.tree.move(dragId, parent, order)
    }
    reload()
  }

  async function onRootDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    setDropInfo(null)
    const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0
    if (hasFiles) {
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = window.api.files.pathForFile(f)
        if (p) await window.api.files.add(p, null)
      }
      reload()
      return
    }
    const dragId = draggingId
    setDraggingId(null)
    if (!dragId) return
    await window.api.tree.move(dragId, null, sortInside(null))
    reload()
  }

  // ---- keyboard --------------------------------------------------------------
  function onKeyDown(e: KeyboardEvent): void {
    if (editing) return
    const id = selectedId
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2', 'Delete'].includes(e.key))
      e.preventDefault()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (visibleIds.length === 0) return
      const idx = id ? visibleIds.indexOf(id) : -1
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(visibleIds.length - 1, idx + 1)
          : Math.max(0, idx - 1)
      onSelect(visibleIds[nextIdx])
    } else if (e.key === 'ArrowRight' && id) {
      const note = byId.get(id)
      if (note?.kind === 'folder' && !isExpanded(id)) toggle(id)
    } else if (e.key === 'ArrowLeft' && id) {
      const note = byId.get(id)
      if (note?.kind === 'folder' && isExpanded(id)) toggle(id)
      else if (note?.parent_id) onSelect(note.parent_id)
    } else if (e.key === 'Enter' && id) {
      const note = byId.get(id)
      if (note?.kind === 'folder') toggle(id)
      else onSelect(id)
    } else if (e.key === 'F2' && id) {
      startRename(id)
    } else if (e.key === 'Delete' && id) {
      softDelete(id)
    }
  }

  // ---- context menu ----------------------------------------------------------
  function openMenu(e: { clientX: number; clientY: number }, targetId: string | null): void {
    setMenu({ x: e.clientX, y: e.clientY, targetId })
  }
  function examItems(note: Note): MenuItem[] {
    return [
      { label: note.exam_date ? `考试日期 ${note.exam_date.slice(5).replace('-', '/')}…` : '设置考试日期…', icon: GraduationCap, onClick: () => setExam(note) },
      ...(note.exam_date ? [{ label: '清除考试日期', icon: CalendarX2, onClick: () => clearExam(note) }] : [])
    ]
  }
  function menuItems(targetId: string | null): MenuItem[] {
    if (targetId === null) {
      return [
        { label: '新建笔记', icon: FilePlus2, onClick: () => startCreate('create-note', null) },
        { label: '新建文件夹', icon: FolderPlus, onClick: () => startCreate('create-folder', null) },
        { label: '上传文件', icon: Upload, onClick: () => upload(null) }
      ]
    }
    const note = byId.get(targetId)
    if (!note) return []
    if (note.kind === 'folder') {
      return [
        { label: '新建子文件夹', icon: FolderPlus, onClick: () => startCreate('create-folder', note.id) },
        { label: '在此新建笔记', icon: FilePlus2, onClick: () => startCreate('create-note', note.id) },
        { label: '在此上传', icon: Upload, onClick: () => upload(note.id) },
        { sep: true },
        { label: '重命名', icon: Pencil, onClick: () => startRename(note.id) },
        ...examItems(note),
        { sep: true },
        { label: '移入回收站', icon: Trash2, danger: true, onClick: () => confirmDeleteFolder(note) }
      ]
    }
    const canReview = note.due_date === null
    return [
      { label: '打开', icon: FolderOpen, onClick: () => onSelect(note.id) },
      { label: '重命名', icon: Pencil, onClick: () => startRename(note.id) },
      ...(canReview ? [{ label: '加入复习', icon: CalendarPlus, onClick: () => addToReview(note.id) }] : []),
      ...examItems(note),
      { sep: true },
      { label: '移入回收站', icon: Trash2, danger: true, onClick: () => softDelete(note.id) }
    ]
  }
  async function confirmDeleteFolder(note: Note): Promise<void> {
    const hasChildren = items.some((i) => i.parent_id === note.id)
    if (
      hasChildren &&
      !(await confirmDialog({
        title: '移入回收站',
        message: `文件夹「${note.title}」非空,连同其中的内容一起移入回收站?`,
        confirmLabel: '移入回收站',
        danger: true
      }))
    )
      return
    softDelete(note.id)
  }

  // ---- render ----------------------------------------------------------------
  function renderInput(depth: number): JSX.Element {
    return (
      <div className="tree-row editing" style={{ paddingLeft: 8 + depth * 16 }}>
        <span className="tree-twisty" />
        <span className="tree-icon">
          {editing?.mode === 'create-folder' ? (
            <Folder size={ICON.sm} strokeWidth={ICON.stroke} className="kind-icon kind-folder" />
          ) : (
            <NotebookPen size={ICON.sm} strokeWidth={ICON.stroke} className="kind-icon kind-markdown" />
          )}
        </span>
        <input
          className="tree-input"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            else if (e.key === 'Escape') setEditing(null)
            e.stopPropagation()
          }}
        />
      </div>
    )
  }

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const note = node.note
    const isFolder = note.kind === 'folder'
    const open = isFolder && isExpanded(note.id)
    const selected = note.id === selectedId
    const renaming = editing?.mode === 'rename' && editing.id === note.id
    const drop = dropInfo && dropInfo.targetId === note.id ? dropInfo : null
    const todayCount = isFolder ? countTodayDue(node, todayDueIds) : 0

    return (
      <div key={note.id}>
        {drop?.pos === 'before' && !drop.illegal && <div className="drop-line" style={{ marginLeft: 8 + depth * 16 }} />}
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(note.id, el)
          }}
          className={
            'tree-row' +
            (selected ? ' selected' : '') +
            (drop?.pos === 'inside' && !drop.illegal ? ' drop-inside' : '') +
            (drop?.illegal ? ' drop-illegal' : '') +
            (matched.has(note.id) ? ' matched' : '')
          }
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable={!renaming}
          onClick={() => (isFolder ? toggle(note.id) : onSelect(note.id))}
          onDragStart={(e) => {
            setDraggingId(note.id)
            e.dataTransfer.setData('text/xnote', note.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDraggingId(null)
            setDropInfo(null)
          }}
          onDragOver={(e) => onRowDragOver(note, e)}
          onDrop={(e) => onRowDrop(note, e)}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onSelect(note.id)
            openMenu(e, note.id)
          }}
        >
          <span className="tree-twisty" onClick={(e) => { e.stopPropagation(); if (isFolder) toggle(note.id) }}>
            {isFolder && <ChevronRight size={ICON.xs} strokeWidth={ICON.stroke} className={open ? 'open' : ''} />}
          </span>
          <span className="tree-icon"><FileKindIcon note={note} open={open} /></span>
          {renaming ? (
            <input
              className="tree-input"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                else if (e.key === 'Escape') setEditing(null)
                e.stopPropagation()
              }}
            />
          ) : (
            <span className="tree-label">{note.title || '无标题'}</span>
          )}

          {/* review badges */}
          {!isFolder && scheduledIds.has(note.id) && (
            <span className={'review-dot' + (todayDueIds.has(note.id) ? ' due-today' : '')} />
          )}
          {isFolder && todayCount > 0 && <span className="folder-due-badge">{todayCount}</span>}
          {note.exam_date && note.exam_date > today && (
            <Tooltip label={`考试日期 ${note.exam_date}`}>
              <span className="exam-mark" aria-label={`考试日期 ${note.exam_date}`}>
                <GraduationCap size={ICON.xs} strokeWidth={ICON.stroke} />
              </span>
            </Tooltip>
          )}

          {/* hover ⋯ menu button */}
          <button
            className="tree-more"
            title="更多"
            aria-label="更多"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(note.id)
              openMenu({ clientX: e.clientX, clientY: e.clientY }, note.id)
            }}
          >
            <MoreHorizontal size={ICON.sm} strokeWidth={ICON.stroke} />
          </button>
        </div>

        {isFolder && (
          <Collapse open={open}>
            {/* inline create input as a child of this folder */}
            {editing && 'parentId' in editing && editing.parentId === note.id && renderInput(depth + 1)}

            {node.children.length === 0 && !(editing && 'parentId' in editing && editing.parentId === note.id) && (
              <div className="tree-empty" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>空文件夹</div>
            )}

            {node.children.map((c) => renderNode(c, depth + 1))}
          </Collapse>
        )}

        {drop?.pos === 'after' && !drop.illegal && <div className="drop-line" style={{ marginLeft: 8 + depth * 16 }} />}
      </div>
    )
  }

  const rootCreateInput =
    editing && 'parentId' in editing && editing.parentId === null ? renderInput(0) : null

  return (
    <div className="tree-col" style={{ width }}>
      <div className="tree-toolbar">
        <div className="tree-tools">
          <IconButton icon={FilePlus2} small label="新建笔记" onClick={() => startCreate('create-note', null)} />
          <IconButton icon={FolderPlus} small label="新建文件夹" onClick={() => startCreate('create-folder', null)} />
          <IconButton icon={Upload} small label="上传文件" onClick={() => upload(null)} />
          <IconButton icon={ChevronsDownUp} small label="全部折叠" onClick={collapseAll} />
        </div>
        <select
          className="sort-select"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          title="排序方式"
        >
          <option value="manual">手动</option>
          <option value="name">名称</option>
          <option value="mtime">修改时间</option>
        </select>
      </div>

      <label className="tree-search">
        <Search size={ICON.xs} strokeWidth={ICON.stroke} />
        <input placeholder="按名称过滤" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div
        className="tree-body"
        ref={bodyRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.target === bodyRef.current) setDropInfo({ targetId: 'root', pos: 'inside' })
        }}
        onDrop={onRootDrop}
        onContextMenu={(e) => {
          if (e.target === bodyRef.current) {
            e.preventDefault()
            openMenu(e, null)
          }
        }}
      >
        {roots.length === 0 && !rootCreateInput ? (
          <EmptyState icon={Library} title="还没有内容" hint="用上方按钮新建笔记,或把文件拖进来" />
        ) : (
          <>
            {roots.map((n) => renderNode(n, 0))}
            {rootCreateInput}
            <div className={'tree-root-drop' + (dropInfo?.targetId === 'root' ? ' active' : '')} />
          </>
        )}
      </div>

      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.targetId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
