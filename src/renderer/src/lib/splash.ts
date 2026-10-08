/**
 * Cold-start splash controller. The splash itself is static markup in
 * index.html (so it is on the very first painted frame); this only decides
 * when to lift it:
 *  - after the draw-in finishes (~760ms from first paint) AND the app is ready;
 *  - if init is slower, the finished (static) mark simply stays — no looping;
 *  - any click / key lifts it immediately (it is click-through, never blocks).
 */
const DRAW_MS = 760
const FADE_MS = 200

declare global {
  interface Window {
    __xnoteSplashT0?: number
    __xnoteReady?: boolean
  }
}

/** Called once the first library load has completed. */
export function signalAppReady(): void {
  if (window.__xnoteReady) return
  window.__xnoteReady = true
  window.dispatchEvent(new Event('xnote:ready'))
}

export function initSplash(): void {
  const root = document.documentElement
  const el = document.getElementById('splash')
  if (!el) return
  if (!root.classList.contains('splash-on')) {
    el.remove()
    return
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let drawn = reduced
  let gone = false

  const lift = (): void => {
    if (gone) return
    gone = true
    window.removeEventListener('pointerdown', lift, true)
    window.removeEventListener('keydown', lift, true)
    el.classList.add('leaving')
    setTimeout(
      () => {
        el.remove()
        root.classList.remove('splash-on')
      },
      reduced ? 0 : FADE_MS
    )
  }
  const check = (): void => {
    if (drawn && window.__xnoteReady) lift()
  }

  // Skip: the event still reaches the app underneath (the layer is click-through).
  window.addEventListener('pointerdown', lift, true)
  window.addEventListener('keydown', lift, true)
  window.addEventListener('xnote:ready', check)
  // The draw clock starts when the window is shown (see splash-boot.js).
  const armDrawTimer = (): void => {
    const t0 = window.__xnoteSplashT0 ?? performance.now()
    setTimeout(
      () => {
        drawn = true
        check()
      },
      Math.max(0, DRAW_MS - (performance.now() - t0))
    )
  }
  if (!drawn) {
    if (root.classList.contains('splash-play')) armDrawTimer()
    else window.addEventListener('xnote:splash-play', armDrawTimer, { once: true })
  }
  check()
}

/** Pause decorative loops while the window is hidden or unfocused. */
export function trackWindowActivity(): void {
  const root = document.documentElement
  const update = (): void => {
    root.classList.toggle('app-idle', document.hidden || !document.hasFocus())
  }
  window.addEventListener('focus', update)
  window.addEventListener('blur', update)
  document.addEventListener('visibilitychange', update)
  update()
}
