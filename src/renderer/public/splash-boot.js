// Runs synchronously before the first paint (classic script; CSP allows 'self').
// Decides whether this load is a cold start: the main process opens the first
// window with #splash, and sessionStorage keeps reloads from replaying it.
;(function () {
  var root = document.documentElement
  var el = document.getElementById('splash')
  var show = false
  try {
    show = location.hash === '#splash' && !sessionStorage.getItem('xnote.splashShown')
    if (show) sessionStorage.setItem('xnote.splashShown', '1')
    if (location.hash === '#splash') history.replaceState(null, '', location.pathname + location.search)
  } catch (e) {
    show = false
  }
  if (show) {
    root.classList.add('splash-on')
    // Start the draw only once the window is actually on screen: the first
    // paint happens before ready-to-show, so main calls __xnoteSplashPlay()
    // right after show(). Until then the splash holds its first (empty) frame;
    // a short fallback guarantees it can never wait forever.
    var play = function () {
      if (root.classList.contains('splash-play')) return
      root.classList.add('splash-play')
      window.__xnoteSplashT0 = performance.now()
      window.dispatchEvent(new Event('xnote:splash-play'))
    }
    window.__xnoteSplashPlay = play
    setTimeout(play, 400)
  } else if (el) {
    el.remove()
  }
})()
