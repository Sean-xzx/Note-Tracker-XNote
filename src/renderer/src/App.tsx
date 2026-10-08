import { useCallback, useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import type { Note } from '../../preload'
import { Sidebar } from './components/Sidebar'
import { FileTree } from './components/FileTree'
import { TrashView } from './components/TrashView'
import { DocumentView } from './components/DocumentView'
import { ReviewSession } from './components/ReviewSession'
import { EmptyState, usePresence, DialogHost } from './components/ui'
import { Folder, MousePointerClick } from 'lucide-react'
import { signalAppReady } from './lib/splash'
import { extractText } from './lib/aiExtract'
import { Splitter } from './components/Splitter'
import { AiPanel } from './components/AiPanel'
import { AnnotationTimeline } from './components/AnnotationTimeline'
import { SettingsView } from './components/SettingsView'

export type View = 'all' | 'review'

interface Layout {
  sidebarW: number
  listW: number
  aiW: number
  aiOpen: boolean
}
const DEFAULT_LAYOUT: Layout = {
  sidebarW: 210,
  listW: 320,
  aiW: 320,
  aiOpen: false
}
const MIN = { sidebarW: 160, listW: 200, aiW: 220 }
const MAX = { sidebarW: 400, listW: 520, aiW: 640 }
const LAYOUT_KEY = 'xnote.layout'
const SELECTED_KEY = 'xnote.selectedId'

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT
}
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function App(): JSX.Element {
  const [view, setView] = useState<View>('all')
  const [trashOpen, setTrashOpen] = useState(false)
  const [treeItems, setTreeItems] = useState<Note[]>([])
  const [due, setDue] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [revealTick, setRevealTick] = useState(0)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [revealAnnoId, setRevealAnnoId] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [dragging, setDragging] = useState(false)
  const [reviewKey, setReviewKey] = useState(0)
  const [reviewDoc, setReviewDoc] = useState<{ id: string; title: string } | null>(null)

  const reloadTree = useCallback(async () => {
    setTreeItems(await window.api.tree.list())
  }, [])
  const reloadDue = useCallback(async () => {
    setDue(await window.api.notes.getDue())
  }, [])
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadTree(), reloadDue()])
  }, [reloadTree, reloadDue])

  // The AI agent (main process) reads PDF / Word / sheets through the renderer's
  // existing extractors (pdf.js, mammoth, xlsx): answer its extraction requests.
  useEffect(
    () =>
      window.api.ai.onExtractRequest(async ({ reqId, id }) => {
        let text: string | null = null
        try {
          const note = await window.api.notes.get(id)
          if (note) text = await extractText(note)
        } catch {
          text = null
        }
        window.api.ai.extractResult(reqId, text)
      }),
    []
  )

  // Initial load + restore last selection.
  useEffect(() => {
    ;(async () => {
      const items = await window.api.tree.list()
      setTreeItems(items)
      await reloadDue()
      const saved = localStorage.getItem(SELECTED_KEY)
      if (saved && items.some((i) => i.id === saved)) setSelectedId(saved)
      signalAppReady() // lets the cold-start splash lift
    })()
  }, [reloadDue])

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
    } catch {
      /* ignore */
    }
  }, [layout])
  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId)
  }, [selectedId])

  function selectItem(id: string): void {
    setTrashOpen(false)
    setTimelineOpen(false)
    setSettingsOpen(false)
    setRevealAnnoId(null)
    setSelectedId(id)
  }

  function openAnnotationInFile(noteId: string, annoId: string): void {
    setTimelineOpen(false)
    setTrashOpen(false)
    setSettingsOpen(false)
    setView('all')
    setSelectedId(noteId)
    setRevealAnnoId(annoId)
    setRevealTick((t) => t + 1)
  }

  const handleAddToReview = useCallback(
    async (id: string): Promise<void> => {
      await window.api.notes.addToReview(id)
      await reloadAll()
    },
    [reloadAll]
  )
  const handleReplace = useCallback(
    async (id: string): Promise<void> => {
      await window.api.files.replace(id)
      await reloadAll()
    },
    [reloadAll]
  )

  // Window-wide OS-file drop (outside the tree) → top-level file items.
  function onDragOver(e: DragEvent): void {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      if (!dragging) setDragging(true)
    }
  }
  function onDragLeave(e: DragEvent): void {
    if (e.currentTarget === e.target) setDragging(false)
  }
  async function onDrop(e: DragEvent): Promise<void> {
    setDragging(false)
    // an image dropped into the markdown editor is inserted there instead
    if (e.nativeEvent.defaultPrevented) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    let lastId: string | null = null
    for (const f of files) {
      const path = window.api.files.pathForFile(f)
      if (path) lastId = (await window.api.files.add(path, null)).id
    }
    await reloadTree()
    if (lastId) {
      setView('all')
      selectItem(lastId)
    }
  }

  function resize(key: 'sidebarW' | 'listW' | 'aiW', dx: number): void {
    setLayout((prev) => ({
      ...prev,
      [key]: clamp(prev[key] + dx, MIN[key], MAX[key])
    }))
  }
  function resetW(key: 'sidebarW' | 'listW' | 'aiW'): void {
    setLayout((prev) => ({ ...prev, [key]: DEFAULT_LAYOUT[key] }))
  }

  function selectFromAi(id: string): void {
    setView('all')
    setTrashOpen(false)
    setSelectedId(id)
    setRevealTick((t) => t + 1) // ask the tree to expand ancestors + scroll
  }

  const selectedNote = treeItems.find((n) => n.id === selectedId) ?? due.find((n) => n.id === selectedId) ?? null
  const openNote = selectedNote && selectedNote.kind !== 'folder' ? selectedNote : null
  const overlayOpen = settingsOpen || timelineOpen || trashOpen
  const ai = usePresence(layout.aiOpen)
  // view switches (library ↔ settings ↔ review ↔ timeline ↔ trash) fade the main area in
  const viewKey = settingsOpen
    ? 'settings'
    : timelineOpen
      ? 'timeline'
      : trashOpen
        ? 'trash'
        : view === 'review'
          ? 'review'
          : 'library'
  const reviewing = view === 'review' && !overlayOpen
  // the document shown in the main area (what the AI panel's "当前文件" refers to):
  // the note under review, the library selection, or none for settings / timeline / trash
  const activeDoc = overlayOpen ? null : reviewing ? reviewDoc : openNote

  return (
    <div
      className={`app ${dragging ? 'drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Sidebar
        view={view}
        dueCount={due.length}
        width={layout.sidebarW}
        aiOpen={layout.aiOpen}
        trashOpen={trashOpen}
        timelineOpen={timelineOpen}
        onChangeView={(v) => {
          if (v === 'review') setReviewKey((k) => k + 1)
          setView(v)
          setTrashOpen(false)
          setTimelineOpen(false)
          setSettingsOpen(false)
        }}
        onOpenTrash={() => {
          setTrashOpen(true)
          setTimelineOpen(false)
          setSettingsOpen(false)
        }}
        onOpenTimeline={() => {
          setTimelineOpen(true)
          setTrashOpen(false)
          setSettingsOpen(false)
        }}
        settingsOpen={settingsOpen}
        onOpenSettings={() => {
          setSettingsOpen(true)
          setTrashOpen(false)
          setTimelineOpen(false)
        }}
        onToggleAi={() => setLayout((p) => ({ ...p, aiOpen: !p.aiOpen }))}
      />
      <Splitter onDrag={(dx) => resize('sidebarW', dx)} onReset={() => resetW('sidebarW')} />

      {!reviewing && (
        <>
          <FileTree
            items={treeItems}
            selectedId={selectedId}
            revealTick={revealTick}
            width={layout.listW}
            onSelect={selectItem}
            reload={reloadAll}
          />
          <Splitter onDrag={(dx) => resize('listW', dx)} onReset={() => resetW('listW')} />
        </>
      )}

      <main className="main-col">
        <div className="view-fade" key={viewKey}>
          {settingsOpen ? (
            <SettingsView onClose={() => setSettingsOpen(false)} />
          ) : timelineOpen ? (
            <AnnotationTimeline onOpen={openAnnotationInFile} onClose={() => setTimelineOpen(false)} />
          ) : trashOpen ? (
            <TrashView onChanged={reloadAll} onClose={() => setTrashOpen(false)} />
          ) : reviewing ? (
            <ReviewSession
              key={reviewKey}
              onExit={() => setView('all')}
              onChanged={reloadAll}
              onSaved={reloadTree}
              onAddToReview={handleAddToReview}
              onReplace={handleReplace}
              onOpenTimeline={() => setTimelineOpen(true)}
              onCurrentChange={setReviewDoc}
            />
          ) : openNote ? (
            <div className="main-inner">
              <DocumentView
                key={openNote.id}
                note={openNote}
                onSaved={reloadTree}
                onAddToReview={handleAddToReview}
                onReplace={handleReplace}
                onOpenTimeline={() => setTimelineOpen(true)}
                revealAnnoId={revealAnnoId}
              />
            </div>
          ) : selectedNote?.kind === 'folder' ? (
            <EmptyState icon={Folder} title={selectedNote.title || '文件夹'} hint="展开它,或从中选择一个条目查看" />
          ) : (
            <EmptyState icon={MousePointerClick} title="选择一个条目" hint="在左侧文件树中选择笔记或文件查看" />
          )}
        </div>
      </main>

      {ai.mounted && (
        <>
          <Splitter onDrag={(dx) => resize('aiW', -dx)} onReset={() => resetW('aiW')} />
          <AiPanel
            leaving={ai.leaving}
            width={layout.aiW}
            currentNoteId={activeDoc?.id ?? null}
            currentNoteTitle={activeDoc?.title ?? null}
            onClose={() => setLayout((p) => ({ ...p, aiOpen: false }))}
            onSelectNote={selectFromAi}
            onOpenSettings={() => {
              setSettingsOpen(true)
              setTrashOpen(false)
              setTimelineOpen(false)
            }}
          />
        </>
      )}

      {dragging && <div className="app-drop-hint">松开以上传到顶层</div>}
      <DialogHost />
    </div>
  )
}

export default App
