const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const asar = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const pkg = path.join(root, 'release/win-unpacked')
const artifacts = path.join(root, 'test-results')
let child, socket
const timer = setTimeout(() => {
  console.error('Packaged application verification timed out')
  socket?.close()
  child?.kill()
  process.exit(1)
}, 60000)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  assert.equal(process.platform, 'win32', 'This packaging check is Windows-only')
  const entries = asar.listPackage(path.join(pkg, 'resources/app.asar')).map((p) => p.replaceAll('\\', '/'))
  for (const p of ['/out/main/index.js', '/out/preload/index.js', '/out/renderer/index.html', '/out/renderer/splash-boot.js']) assert(entries.includes(p), `Missing packaged entry: ${p}`)
  assert(!entries.some((p) => /^\/(\.shots|docs|tests|src|\.github)(\/|$)/.test(p)))
  assert(!entries.some((p) => /\/(ai-keys\.enc|xnote\.db|ai-settings\.json)$/.test(p)))
  assert(fs.existsSync(path.join(pkg, 'resources/xnote.ico')))
  assert(fs.existsSync(path.join(pkg, 'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node')))
  console.log('PASS packaged entrypoints, splash, icon, native SQLite and private-file exclusion')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xnote-packaged-'))
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(env)) if (key.startsWith('XNOTE_')) delete env[key]
  child = spawn(path.join(pkg, 'XNote.exe'), ['--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = '', spawnError
  child.stderr.on('data', (data) => { stderr += data })
  child.stdout.on('data', () => {})
  child.on('error', (error) => { spawnError = error })
  fs.mkdirSync(artifacts, { recursive: true })
  try {
    let target
    for (let i = 0; i < 150; i++) {
      if (spawnError) throw spawnError
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
        if (target) break
      } catch {}
      await wait(100)
    }
    assert(target, 'Packaged executable did not expose its page')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let seq = 0
    const pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    })
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression) => {
      const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      assert(!message.error && !message.result?.exceptionDetails, 'Packaged renderer evaluation failed')
      return message.result.result.value
    }
    let ready = false
    for (let i = 0; i < 150; i++) {
      ready = await evaluate('!!(window.api && document.querySelector(".app"))')
      if (ready) break
      await wait(100)
    }
    assert(ready)
    assert(fs.existsSync(path.join(profile, 'xnote.db')), 'Explicit isolated profile was not used')
    assert.equal(await evaluate('window.api.tree.list().then(t=>t.length)'), 0)
    const note = await evaluate('window.api.notes.create("Packaged smoke test")')
    assert(note.id)
    const content = '# Packaged smoke test\n\nPersisted by the actual executable.\n'
    await evaluate('window.api.notes.saveContent(' + JSON.stringify(note.id) + ',' + JSON.stringify(content) + ')')
    assert.equal((await evaluate('window.api.notes.getContent(' + JSON.stringify(note.id) + ')')).content, content)
    console.log('PASS actual XNote.exe boot, isolated database, IPC and note save/read')
    fs.writeFileSync(path.join(artifacts, 'packaged-summary.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), profile, entries: entries.length }, null, 2))
    // Closing the browser can disconnect before CDP returns a response.
    socket.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }))
    await wait(400)
  } finally {
    socket?.close()
    if (child.exitCode === null) await wait(700)
    if (child.exitCode === null) child.kill()
    fs.writeFileSync(path.join(artifacts, 'packaged.log'), stderr)
  }
}
main().then(() => clearTimeout(timer)).catch((error) => {
  clearTimeout(timer)
  socket?.close()
  child?.kill()
  console.error(error.stack)
  process.exitCode = 1
})
