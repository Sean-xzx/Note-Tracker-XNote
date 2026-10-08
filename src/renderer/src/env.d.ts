/// <reference types="vite/client" />

import type { XNoteApi } from '../../preload'

declare global {
  interface Window {
    api: XNoteApi
  }
}
