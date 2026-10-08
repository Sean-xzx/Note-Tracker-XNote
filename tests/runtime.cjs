const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const profile = process.env.XNOTE_TEST_PROFILE
assert(profile, 'Run through npm test to use an isolated profile')
app.setPath('userData', profile)
app.on('browser-window-created', (_event, win) => {
  win.show = () => {}
  win.webContents.setBackgroundThrottling(false)
})
global.fetch = async () => { throw new Error('Network disabled in offline runtime verification') }
require(path.join(root, 'out/main/index.js'))
const phase = process.argv[2]
const statePath = path.join(profile, 'verification-state.json')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('Runtime verification timed out'); app.exit(1) }, 60000)

app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 150; i++) {
    win = BrowserWindow.getAllWindows()[0]
    if (win && !win.webContents.isLoading()) {
      if (await win.webContents.executeJavaScript('!!(window.api && document.querySelector(".app"))')) break
    }
    await wait(100)
  }
  assert(win, 'Application window must exist')
  win.setSize(1400, 950)
  const js = (s) => win.webContents.executeJavaScript(s)
  const call = (name, ...args) => js('window.api.' + name + '(' + args.map((a) => JSON.stringify(a)).join(',') + ')')
  assert.equal(await call('ping'), 'pong')

  if (phase === 'seed') {
    assert.deepEqual(await call('tree.list'), [], 'Fresh profile must not contain private data')
    const folder = await call('folders.create', 'Demo library')
    const note = await call('notes.create', 'XNote demo', folder.id)
    const body = '# XNote demo\n\nLocal notes, annotations and spaced repetition.\n\n- [x] Markdown editing\n- [ ] Review tomorrow\n\n**Verification phrase:** orbital notebook\n\nFormula: $a^2+b^2=c^2$.\n\n| Feature | Storage |\n| --- | --- |\n| Notes | Local Markdown |\n| Annotations | SQLite |\n\n```js\nconsole.log("XNote")\n```\n'
    await call('notes.saveContent', note.id, body)
    assert.equal((await call('notes.getContent', note.id)).content, body)
    const importPath = path.join(profile, 'lossless.md')
    const bytes = Buffer.from('\ufeff# Imported example\r\n\r\nOriginal line endings.\r\n')
    fs.writeFileSync(importPath, bytes)
    const imported = await call('files.add', importPath, folder.id)
    assert.equal(imported.kind, 'markdown')
    assert.deepEqual(fs.readFileSync(path.join(profile, 'notes', imported.id + '.md')), bytes)
    const textPath = path.join(profile, 'example.txt')
    fs.writeFileSync(textPath, 'Plain text input: orbital notebook\n')
    const text = await call('files.add', textPath, folder.id)
    assert.equal(text.state, 'library')
    assert.equal(text.due_date, null)
    assert.equal(Buffer.from(await call('files.getBytes', text.id)).toString(), 'Plain text input: orbital notebook\n')
    await call('files.saveText', text.id, 'Edited plain text: orbital notebook\n')
    const annotation = await call('annotations.add', note.id, {
      type: 'highlight', color: 'yellow', quote: 'Local notes',
      anchor: { text: 'Local notes', prefix: '\n\n', suffix: ', annotations',
        locator: { type: 'md', start: body.indexOf('Local notes'), end: body.indexOf('Local notes') + 11 } }
    })
    assert.equal((await call('annotations.list', note.id))[0].id, annotation.id)
    const preview = await call('review.preview', note.id)
    assert.deepEqual(Object.keys(preview).sort(), ['1', '2', '3', '4'])
    assert(Object.values(preview).every((p) => p.interval >= 1))
    const queue = await call('review.queue')
    assert(queue.items.some((i) => i.note.id === note.id))
    await call('review.complete', note.id, 3, 'Verified recall and reflection.', 12000)
    assert.equal((await call('review.history', note.id))[0].reflection, 'Verified recall and reflection.')
    const rated = await call('notes.get', note.id)
    assert(rated.interval_days >= 1 && rated.stability > 0)
    const nested = await call('folders.create', 'Nested', folder.id)
    assert.equal(await call('tree.move', folder.id, nested.id, 1), null)
    assert.equal((await call('notes.get', folder.id)).parent_id, null)
    await call('tree.softDelete', nested.id)
    assert((await call('tree.listTrash')).some((n) => n.id === nested.id))
    await call('tree.restore', nested.id)
    assert((await call('tree.list')).some((n) => n.id === nested.id))
    await call('ai.saveSettings', { provider: 'mock', embedProvider: 'mock', webSearch: { enabled: false } })
    const indexed = await call('ai.indexNote', note.id, body)
    assert.equal(indexed.status, 'indexed')
    assert.equal((await call('ai.indexNote', note.id, body)).status, 'skipped')
    assert((await call('ai.find', 'orbital notebook')).some((h) => h.noteId === note.id))
    const conversation = await call('chat.create', 'Offline verification', { provider: 'mock', model: 'mock-chat' })
    await call('chat.addMessage', conversation.id, 'user', '总结《XNote demo》', null)
    await js('window.__verificationEvents=[];window.__verificationUnsub=window.api.ai.onStream(e=>window.__verificationEvents.push(e));true')
    const requestId = 'offline-verification'
    await call('ai.ask', { requestId, question: '总结《XNote demo》', history: [], scope: 'current', currentNoteId: note.id, web: false, model: { provider: 'mock', model: 'mock-chat' } })
    const events = await js('window.__verificationEvents')
    assert(events.some((e) => e.requestId === requestId && e.type === 'done'))
    assert(!events.some((e) => e.type === 'error'))
    assert(events.some((e) => e.type === 'step' && e.step.tool === 'read_file' && e.step.ok))
    const answer = events.filter((e) => e.type === 'delta').map((e) => e.delta).join('')
    assert(answer.length > 0)
    const sources = events.find((e) => e.type === 'sources')?.sources || []
    await call('chat.addMessage', conversation.id, 'assistant', answer, sources)
    assert.equal((await call('chat.messages', conversation.id)).length, 2)
    await js('window.__verificationUnsub();localStorage.setItem("xnote.selectedId",' + JSON.stringify(note.id) + ')')
    fs.writeFileSync(statePath, JSON.stringify({ folder: folder.id, note: note.id, text: text.id, imported: imported.id, annotation: annotation.id, conversation: conversation.id, body }))
    console.log('PASS fresh application, Markdown round-trip, byte-preserving import and plain-text edits')
    console.log('PASS annotations, FSRS preview/queue/rating/reflection, move-cycle rejection and trash restore')
    console.log('PASS offline indexing/search, mock streamed answer and conversation persistence')
  } else {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal((await call('notes.getContent', state.note)).content, state.body)
    assert.equal((await call('annotations.list', state.note))[0].id, state.annotation)
    assert.equal((await call('review.history', state.note))[0].rating, 3)
    assert.equal((await call('chat.messages', state.conversation)).length, 2)
    assert.equal(Buffer.from(await call('files.getBytes', state.text)).toString(), 'Edited plain text: orbital notebook\n')
    assert.equal((await call('ai.getSettings')).provider, 'mock')
    for (let i = 0; i < 100; i++) {
      if (await js('!!document.querySelector(".md-editor .cm-content")')) break
      await wait(100)
    }
    assert.equal(await js('document.querySelector(".md-editor .cm-content").cmTile.root.view.state.doc.toString()'), state.body)
    await wait(400)
    const artifacts = process.env.XNOTE_TEST_ARTIFACT_DIR
    fs.writeFileSync(path.join(artifacts, 'demo.png'), (await win.webContents.capturePage()).toPNG())
    console.log('PASS restart persistence and real rendered Markdown; synthetic demo screenshot captured')
  }
  clearTimeout(timeout)
  app.exit(0)
}).catch((error) => { console.error(error.stack); app.exit(1) })
