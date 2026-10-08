// Zoom state, persisted per document class so each type remembers its own level.
//
// For text-ish documents (markdown source + preview, text, docx, sheets) the
// level drives the CSS variable --doc-font-scale, so every mode of a document
// shares one size. For PDF and images, 100% means "fit to the column width"
// (the default way they open); the level scales relative to that.

export type ZoomClass = 'pdf' | 'image' | 'doc' | 'sheet' | 'text' | 'markdown'

export interface ZoomState {
  pct: number // 100 = default size
}

const KEY = (c: ZoomClass): string => `xnote.zoom.v2.${c}`
export const MIN_PCT = 40
export const MAX_PCT = 400
export const DEFAULT_ZOOM: ZoomState = { pct: 100 }

export function loadZoom(c: ZoomClass): ZoomState {
  try {
    const raw = localStorage.getItem(KEY(c))
    if (raw) {
      const z = JSON.parse(raw) as Partial<ZoomState>
      if (typeof z.pct === 'number') return { pct: clampPct(z.pct) }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ZOOM
}

export function saveZoom(c: ZoomClass, z: ZoomState): void {
  try {
    localStorage.setItem(KEY(c), JSON.stringify(z))
  } catch {
    /* ignore */
  }
}

/** Clamp (no rounding, so trackpad pinch stays smooth; round only for display). */
export const clampPct = (p: number): number => Math.max(MIN_PCT, Math.min(MAX_PCT, p))

/** One zoom "step" for the −/+ buttons: multiplicative so it feels even at any level. */
export const stepZoom = (pct: number, dir: 1 | -1): number => clampPct(Math.round(pct * (dir > 0 ? 1.1 : 1 / 1.1)))
