# Source map / 完整源码索引

Generated from current source by `node scripts/source-map.cjs`. All 82 source files are included. Type-only imports describe compile-time contracts, not runtime execution. HTML/script loading, re-exports, dynamic imports and IPC are not fully represented by this static table; see [architecture](architecture.md) for workflows. / 当前源码的静态索引；类型引用不是运行时调用，不能据此判断入口或旧代码可删除。

| File / 文件 | Lines / 行数 | Exported declarations / 导出声明 | Direct local imports / 本地引用 |
| --- | --- | --- | --- |
| [src/main/ai.ts](../src/main/ai.ts) | 63 | isAiConfigured, AiSearchHit, aiSearch | ./notes, ./noteFiles |
| [src/main/aiAgent.ts](../src/main/aiAgent.ts) | 397 | ChatSource, StepTool, AgentStep, ModelRef, AgentRequest, AgentEvent, runAgent | ./aiConfig, ./aiProviders, ./aiLibrary, ./webSearch, ./notes |
| [src/main/aiChat.ts](../src/main/aiChat.ts) | 158 | Conversation, StoredMessage, createConversation, listConversations, renameConversation, setConversationModel, touchConversation, deleteConversation, listMessages, addMessage, deleteMessage, deriveTitle | ./db, ./notes, type: ./aiAgent |
| [src/main/aiConfig.ts](../src/main/aiConfig.ts) | 261 | ProviderId, SearchProviderId, ALL_PROVIDERS, ModelCache, VisionCheck, WebSearchSettings, ProviderConfig, ProviderCaps, RetrievalInfo, PublicAiSettings, getKey, setKey, getPublicSettings, saveSettings, activeChatProvider, realEmbeddingProvider, activeProvider, saveModelCache, saveVisionCheck, providerConfig, activeWebSearch | — |
| [src/main/aiIndex.ts](../src/main/aiIndex.ts) | 277 | PlanItem, indexPlan, IndexResult, indexNote, clearIndex, indexStatus, queryTerms, keywordScore, SemanticHit, semanticSearch | ./db, ./notes, ./aiConfig, ./aiProviders |
| [src/main/aiLibrary.ts](../src/main/aiLibrary.ts) | 238 | ItemKind, itemKind, KIND_LABEL, folderPath, LibraryItem, libraryItems, libraryManifest, resolveExtract, itemText, LibraryHit, librarySearch | ./db, ./notes, ./noteFiles, ./fileStore, ./aiConfig, ./aiIndex |
| [src/main/aiModels.ts](../src/main/aiModels.ts) | 140 | refreshModels, verifyVision | ./aiConfig, ./aiProviders, ./notes |
| [src/main/aiProviders.ts](../src/main/aiProviders.ts) | 599 | ChatMessage, ChatOpts, ToolDef, ToolCall, AgentMessage, ToolChatOpts, ToolChatResult, AIProvider, getProvider | type: ./aiConfig |
| [src/main/annotations.ts](../src/main/annotations.ts) | 228 | AnnoType, TextLocator, PdfLocator, RectLocator, DrawingLocator, MdLocator, AnnoLocator, AnnoAnchor, Annotation, NewAnnotation, addAnnotation, listAnnotations, updateAnnotation, deleteAnnotation, restoreAnnotation, AnnotationWithNote, listAllAnnotations, listAnnotationsByDate, updateAnchors | ./db, ./notes |
| [src/main/db.ts](../src/main/db.ts) | 436 | getDb, closeDb | ./fsrs |
| [src/main/fileStore.ts](../src/main/fileStore.ts) | 115 | filesDir, guessMime, fileNameWithoutExt, StoredFile, storeFile, storedFilePath, readStoredBytes, writeStoredFileText, deleteStoredFile | — |
| [src/main/fsrs.ts](../src/main/fsrs.ts) | 178 | Grade, GroupParams, PARAM_LIMITS, DEFAULT_W, DEFAULT_PARAMS, sanitizeParams, Memory, nextMemory, retrievability, localDay, addDays, dayDiff, baseInterval, ScheduleCtx, schedule, simulate | — |
| [src/main/index.ts](../src/main/index.ts) | 136 | — | ./db, ./ipc, ./notes, ./review, ./fileStore |
| [src/main/ipc.ts](../src/main/ipc.ts) | 383 | registerIpcHandlers | ./notes, ./review, type: ./fsrs, ./ai, ./aiConfig, ./aiProviders, ./aiAgent, ./aiLibrary, ./aiModels, ./webSearch, ./aiIndex, ./aiChat, ./annotations |
| [src/main/noteFiles.ts](../src/main/noteFiles.ts) | 120 | notesDir, noteFileName, noteFilePath, writeNoteFile, readNoteFile, deleteNoteFile, readNoteBytes, spliceBytes | — |
| [src/main/notes.ts](../src/main/notes.ts) | 797 | Note, NoteUpdate, nowIso, localDate, todayDate, localDayRange, firstH1, createNote, createFolder, getNote, listNotes, getDueNotes, createImageAsset, organizeImageAssets, createFileItem, uploadFileItems, getFileBytes, saveFileText, pickAndReplaceFile, openFileInSystem, addToReview, updateNote, NoteContent, saveNoteContent, getNoteContent, deleteNote, renameItem, moveItem, listTree, softDelete, restore, listTrash, permanentlyDelete, emptyTrash | ./db, ./noteFiles, ./fileStore |
| [src/main/review.ts](../src/main/review.ts) | 662 | Rating, ParamGroup, groupParams, listGroups, createGroup, renameGroup, deleteGroup, updateGroupParams, assignFolder, ReviewPrefs, getReviewPrefs, saveReviewPrefs, setExamDate, previewNote, reviewNote, completeReview, QueueGroup, QueueItem, QueueResult, getReviewQueue, ReviewHistoryEntry, getReviewHistory, getReviewSummary, ReviewStats, getReviewStats, SimPattern, simulateGroup, OptimizeResult, optimizeGroup, applyWeights, MigrationReport, runFsrsReplayIfPending, getMigrationReport | ./db, ./notes, ./fsrs |
| [src/main/webSearch.ts](../src/main/webSearch.ts) | 90 | WebResult, getSearchBackend, SEARCH_PROVIDER_NAME, testWebSearch | ./aiConfig |
| [src/preload/index.ts](../src/preload/index.ts) | 260 | XNoteApi | type: ../main/notes, type: ../main/review, type: ../main/fsrs, type: ../main/ai, type: ../main/aiConfig, type: ../main/aiIndex, type: ../main/aiChat, type: ../main/aiAgent, type: ../main/aiLibrary, type: ../main/annotations |
| [src/renderer/index.html](../src/renderer/index.html) | 122 | — | — |
| [src/renderer/public/splash-boot.js](../src/renderer/public/splash-boot.js) | 33 | — | — |
| [src/renderer/src/App.tsx](../src/renderer/src/App.tsx) | 331 | View | type: ../../preload, ./components/Sidebar, ./components/FileTree, ./components/TrashView, ./components/DocumentView, ./components/ReviewSession, ./components/ui, ./lib/splash, ./lib/aiExtract, ./components/Splitter, ./components/AiPanel, ./components/AnnotationTimeline, ./components/SettingsView |
| [src/renderer/src/components/AiPanel.tsx](../src/renderer/src/components/AiPanel.tsx) | 735 | AiPanel | type: ../../../preload, ./ui, ../lib/format, ../lib/fileIcon, ./XMark, ./ChatMarkdown |
| [src/renderer/src/components/AnnotationSidebar.tsx](../src/renderer/src/components/AnnotationSidebar.tsx) | 200 | AnnotationSidebar | type: ../../../preload, ../lib/annoColors, ../lib/annoTools, ./ColorPicker, ./ui, ../lib/format |
| [src/renderer/src/components/AnnotationTimeline.tsx](../src/renderer/src/components/AnnotationTimeline.tsx) | 114 | AnnotationTimeline | type: ../../../preload, ../lib/annoColors, ../lib/annoTools, ./ui, ../lib/format |
| [src/renderer/src/components/AnnotationToolbar.tsx](../src/renderer/src/components/AnnotationToolbar.tsx) | 62 | AnnotationToolbar | type: ../../../preload, ./ui, ./ColorPicker |
| [src/renderer/src/components/ChatMarkdown.tsx](../src/renderer/src/components/ChatMarkdown.tsx) | 161 | ChatMarkdown | ../lib/chatMarkdown, ../lib/md/imageSize, ./ui |
| [src/renderer/src/components/ColorPicker.tsx](../src/renderer/src/components/ColorPicker.tsx) | 167 | ColorPanel, ColorButton, ColorSwatchButton | ../lib/annoColors, ./ui |
| [src/renderer/src/components/DocShell.tsx](../src/renderer/src/components/DocShell.tsx) | 153 | DocShell, ZoomControls, AddToReviewButton, ReplaceFileButton | type: ../lib/zoom, ../lib/zoom, ../lib/docChrome, ./ui |
| [src/renderer/src/components/DocumentView.tsx](../src/renderer/src/components/DocumentView.tsx) | 522 | DocumentView | type: ../../../preload, ../lib/zoom, ../lib/selection, ../lib/annoTools, ../lib/annoColors, ../lib/annoMotion, type: ../lib/annoRender, ../lib/docChrome, ./DocShell, ./FileTitleInput, ./AnnotationToolbar, ./AnnotationSidebar, ./PenToolbar, ./Splitter, ./ui, ./renderers/MarkdownRenderer, ./renderers/PdfRenderer, ./renderers/DocxRenderer, ./renderers/ImageRenderer, ./renderers/SheetRenderer, ./renderers/TextRenderer |
| [src/renderer/src/components/FileTitleInput.tsx](../src/renderer/src/components/FileTitleInput.tsx) | 37 | FileTitleInput | type: ../../../preload |
| [src/renderer/src/components/FileTree.tsx](../src/renderer/src/components/FileTree.tsx) | 633 | FileTree | type: ../../../preload, ../lib/fileIcon, ./ui, ../lib/tree, ./TreeContextMenu |
| [src/renderer/src/components/FreehandLayer.tsx](../src/renderer/src/components/FreehandLayer.tsx) | 201 | FreehandLayer | type: ../../../preload, ../lib/annoColors, type: ../lib/annoRender, ../lib/strokeGeom |
| [src/renderer/src/components/HtmlAnnoView.tsx](../src/renderer/src/components/HtmlAnnoView.tsx) | 87 | HtmlAnnoView | ../lib/annoRender, ./FreehandLayer |
| [src/renderer/src/components/MdEditor.tsx](../src/renderer/src/components/MdEditor.tsx) | 507 | MdEditor | type: ../../../preload, type: ../lib/annoRender, ../lib/docChrome, type: ../lib/useAutosave, ../lib/annoMotion, ../lib/md/syntax, ../lib/md/livePreview, ../lib/md/annos, ../lib/md/commands, ../lib/md/anchors, ./MdSearchPanel, ./FreehandLayer, ./TreeContextMenu, ../lib/md/imageSize, ../lib/md/widgets |
| [src/renderer/src/components/MdSearchPanel.tsx](../src/renderer/src/components/MdSearchPanel.tsx) | 207 | openReplacePanel, createSearchPanel | ./ui |
| [src/renderer/src/components/PenToolbar.tsx](../src/renderer/src/components/PenToolbar.tsx) | 116 | PEN_SIZES, PenToolbar | type: ../lib/annoRender, ./ui, ./ColorPicker |
| [src/renderer/src/components/ReviewSession.tsx](../src/renderer/src/components/ReviewSession.tsx) | 553 | ReviewSession | type: ../../../preload, ../lib/fileIcon, ./DocumentView, ./ui, ./XMark, ../lib/format |
| [src/renderer/src/components/ReviewSettings.tsx](../src/renderer/src/components/ReviewSettings.tsx) | 426 | ReviewSettings | type: ../../../preload, ./ui |
| [src/renderer/src/components/SettingsView.tsx](../src/renderer/src/components/SettingsView.tsx) | 520 | SettingsView | type: ../../../preload, ../lib/aiIndexRunner, ./ui, ./ReviewSettings |
| [src/renderer/src/components/Sidebar.tsx](../src/renderer/src/components/Sidebar.tsx) | 92 | Sidebar | type: ../App, ./ui, ./XMark |
| [src/renderer/src/components/Splitter.tsx](../src/renderer/src/components/Splitter.tsx) | 66 | Splitter | — |
| [src/renderer/src/components/TrashView.tsx](../src/renderer/src/components/TrashView.tsx) | 83 | TrashView | type: ../../../preload, ../lib/fileIcon, ./ui, ../lib/format |
| [src/renderer/src/components/TreeContextMenu.tsx](../src/renderer/src/components/TreeContextMenu.tsx) | 94 | MenuItem, TreeContextMenu | ./ui |
| [src/renderer/src/components/XMark.tsx](../src/renderer/src/components/XMark.tsx) | 67 | XMarkState, XMark | — |
| [src/renderer/src/components/renderers/DocxRenderer.tsx](../src/renderer/src/components/renderers/DocxRenderer.tsx) | 86 | DocxRenderer | type: ../../../../preload, type: ../../lib/zoom, ../ui, type: ../../lib/annoRender, ../DocShell, ../FileTitleInput, ../HtmlAnnoView |
| [src/renderer/src/components/renderers/ImageRenderer.tsx](../src/renderer/src/components/renderers/ImageRenderer.tsx) | 135 | ImageRenderer | type: ../../../../preload, type: ../../lib/zoom, ../../lib/annoColors, type: ../../lib/annoRender, ../DocShell, ../FileTitleInput, ../FreehandLayer |
| [src/renderer/src/components/renderers/MarkdownRenderer.tsx](../src/renderer/src/components/renderers/MarkdownRenderer.tsx) | 87 | MarkdownRenderer | type: ../../../../preload, type: ../../lib/zoom, type: ../../lib/useAutosave, type: ../../lib/annoRender, type: ../../lib/md/livePreview, ../DocShell, ../ui, ../MdEditor, ../../lib/docChrome |
| [src/renderer/src/components/renderers/PdfRenderer.tsx](../src/renderer/src/components/renderers/PdfRenderer.tsx) | 374 | PdfRenderer | type: ../../../../preload, type: ../../lib/zoom, ../ui, ../../lib/annoRender, ../../lib/annoColors, ../DocShell, ../FileTitleInput, ../FreehandLayer |
| [src/renderer/src/components/renderers/SheetRenderer.tsx](../src/renderer/src/components/renderers/SheetRenderer.tsx) | 159 | SheetRenderer | type: ../../../../preload, type: ../../lib/zoom, ../ui, ../../lib/annoRender, ../DocShell, ../FileTitleInput |
| [src/renderer/src/components/renderers/TextRenderer.tsx](../src/renderer/src/components/renderers/TextRenderer.tsx) | 84 | TextRenderer | type: ../../../../preload, type: ../../lib/zoom, ../../lib/useAutosave, ../../lib/textareaTab, type: ../../lib/annoRender, ../DocShell, ../ui, ../FileTitleInput, ../HtmlAnnoView, ../../lib/docChrome |
| [src/renderer/src/components/ui.tsx](../src/renderer/src/components/ui.tsx) | 366 | ICON, Tooltip, IconButton, Popover, EmptyState, motionMs, usePresence, Skeleton, HlProgress, Collapse, SaveStatus, confirmDialog, promptDialog, DialogHost | — |
| [src/renderer/src/design.css](../src/renderer/src/design.css) | 5224 | — | — |
| [src/renderer/src/env.d.ts](../src/renderer/src/env.d.ts) | 10 | — | type: ../../preload |
| [src/renderer/src/lib/aiExtract.ts](../src/renderer/src/lib/aiExtract.ts) | 72 | extractText | type: ../../../preload |
| [src/renderer/src/lib/aiIndexRunner.ts](../src/renderer/src/lib/aiIndexRunner.ts) | 55 | IndexProgress, IndexSummary, reindex | ./aiExtract |
| [src/renderer/src/lib/annoColors.ts](../src/renderer/src/lib/annoColors.ts) | 118 | AnnoColor, ANNO_COLORS, PRESET_HEX, colorByToken, isHex, hexToRgb, hexToRgba, resolveColor, hsvToHex, hexToHsv, isColorValue, swatchOf, loadRecentColors, pushRecentColor | — |
| [src/renderer/src/lib/annoMotion.ts](../src/renderer/src/lib/annoMotion.ts) | 91 | markFresh, sweepTiming, fadeOutAnno, takeFresh | — |
| [src/renderer/src/lib/annoRender.ts](../src/renderer/src/lib/annoRender.ts) | 213 | PenTool, EraserMode, NewStroke, PenProps, AnnoRenderProps, locateInText, buildCharRange, LocalRect, PaintResult, paintCharAnnos, hitTest | type: ../../../preload, ./annoColors, ./annoMotion |
| [src/renderer/src/lib/annoTools.ts](../src/renderer/src/lib/annoTools.ts) | 47 | Tool, loadTool, saveTool, loadColor, saveColor, relativeTime | type: ../../../preload |
| [src/renderer/src/lib/chatMarkdown.ts](../src/renderer/src/lib/chatMarkdown.ts) | 94 | prepareMarkdown, hastText | — |
| [src/renderer/src/lib/docChrome.ts](../src/renderer/src/lib/docChrome.ts) | 49 | DocMode, DocChrome, AnchorPick, AnchorSource, DocChromeContext, useDocChrome | type: ./zoom, type: ../../../preload |
| [src/renderer/src/lib/fileIcon.tsx](../src/renderer/src/lib/fileIcon.tsx) | 70 | kindOf, FileKindIcon, KindGlyph | type: ../../../preload |
| [src/renderer/src/lib/format.ts](../src/renderer/src/lib/format.ts) | 36 | formatBytes, formatWhen, formatDay | — |
| [src/renderer/src/lib/markdown.ts](../src/renderer/src/lib/markdown.ts) | 13 | renderMarkdown | — |
| [src/renderer/src/lib/md/anchors.ts](../src/renderer/src/lib/md/anchors.ts) | 179 | visibleText, plainQuote, mdAnchor, relocate, migrateLegacy | type: ../../../../preload, ../annoRender |
| [src/renderer/src/lib/md/annos.ts](../src/renderer/src/lib/md/annos.ts) | 82 | EditorAnno, setAnnos, annoField, annoRanges, annotations | ../annoColors |
| [src/renderer/src/lib/md/commands.ts](../src/renderer/src/lib/md/commands.ts) | 218 | INDENT, EditorCommandHooks, markdownEditing | — |
| [src/renderer/src/lib/md/imageSize.ts](../src/renderer/src/lib/md/imageSize.ts) | 105 | MIN_IMAGE_WIDTH, parseImageAlt, imageAt, imagesOnLine, setImageWidth, zoomAt, readingWidth, clampWidth, pastedImageWidth | — |
| [src/renderer/src/lib/md/livePreview.ts](../src/renderer/src/lib/md/livePreview.ts) | 656 | RenderMode, setRenderMode, renderModeField, livePreview | ./render, ./imageSize, ./widgets |
| [src/renderer/src/lib/md/render.ts](../src/renderer/src/lib/md/render.ts) | 127 | MathResult, renderMath, CodeToken, highlightCode, inlineHtml, renderMermaid, resolveImageSrc | — |
| [src/renderer/src/lib/md/syntax.ts](../src/renderer/src/lib/md/syntax.ts) | 133 | markTag, mathTag, markdownExtensions, markdownSupport | — |
| [src/renderer/src/lib/md/widgets.ts](../src/renderer/src/lib/md/widgets.ts) | 472 | BulletWidget, OrderWidget, CheckboxWidget, HrWidget, CodeHeadWidget, SpacerWidget, InlineMathWidget, BlockMathWidget, TableModel, splitRow, parseTable, TableWidget, MermaidWidget, ImageSpec, imageTarget, ImageWidget, ImageLineWidget | ./render, ./imageSize |
| [src/renderer/src/lib/selection.ts](../src/renderer/src/lib/selection.ts) | 98 | DocAnchor, textareaAnchor, computeAnchor | — |
| [src/renderer/src/lib/splash.ts](../src/renderer/src/lib/splash.ts) | 89 | signalAppReady, initSplash, trackWindowActivity | — |
| [src/renderer/src/lib/strokeGeom.ts](../src/renderer/src/lib/strokeGeom.ts) | 75 | Pt, distToPolyline, densify, strokeTouched, cutStroke | — |
| [src/renderer/src/lib/textareaTab.ts](../src/renderer/src/lib/textareaTab.ts) | 40 | handleTextareaTab | — |
| [src/renderer/src/lib/tree.ts](../src/renderer/src/lib/tree.ts) | 104 | SortMode, TreeNode, buildTree, sortTree, filterTree, ancestorIds, isSelfOrDescendant, countTodayDue | type: ../../../preload |
| [src/renderer/src/lib/useAutosave.ts](../src/renderer/src/lib/useAutosave.ts) | 76 | SaveStatus, useAutosave | — |
| [src/renderer/src/lib/zoom.ts](../src/renderer/src/lib/zoom.ts) | 45 | ZoomClass, ZoomState, MIN_PCT, MAX_PCT, DEFAULT_ZOOM, loadZoom, saveZoom, clampPct, stepZoom | — |
| [src/renderer/src/main.tsx](../src/renderer/src/main.tsx) | 16 | — | ./App, ./styles.css, ./design.css, ./lib/splash |
| [src/renderer/src/styles.css](../src/renderer/src/styles.css) | 434 | — | — |
