import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ZoomState } from './zoom'
import type { AnnoAnchor } from '../../../preload'

/** How the user is interacting with a document. */
export type DocMode = 'read' | 'annotate' | 'pen'

/**
 * Document-level chrome owned by DocumentView and rendered by the shared
 * DocShell (so every renderer gets the same header, mode switch, pen bar and
 * Ctrl+wheel zoom without each one re-implementing it).
 */
export interface DocChrome {
  mode: DocMode
  setMode: (m: DocMode) => void
  canDraw: boolean
  canRect: boolean
  rectMode: boolean
  toggleRect: () => void
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
  /** Slide-down bar shown under the header while `belowOpen` (the pen toolbar). */
  below: ReactNode
  belowOpen: boolean
  annoCount: number
  sidebarOpen: boolean
  toggleSidebar: () => void
  /** Open editable docs in their reading view (review sessions). */
  preferRead: boolean
  /**
   * A renderer with its own selection model (the markdown editor) supplies the
   * annotation anchor for the current selection. Return undefined when the
   * selection is not in that renderer.
   */
  setAnchorSource: (fn: AnchorSource | null) => void
}

export interface AnchorPick {
  anchor: AnnoAnchor
  /** display text (rendered words, without markdown syntax) */
  quote: string
  rect: { x: number; y: number; width: number; height: number }
}
export type AnchorSource = () => AnchorPick | null | undefined

export const DocChromeContext = createContext<DocChrome | null>(null)
export const useDocChrome = (): DocChrome | null => useContext(DocChromeContext)
