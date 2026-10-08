// Isolated regression: existing/new attachments, stable references, image rhythm.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '..')
const profile = process.env.XNOTE_TEST_PROFILE
assert(profile, 'Run through npm test to use an isolated profile')
const statePath = path.join(profile, 'attachment-state.json')
const phase = process.argv[2] || 'seed'
app.setPath('userData', profile)
app.on('browser-window-created', (_event, win) => {
  win.show = () => {} // no foreground window; never touch the real profile
  win.webContents.setBackgroundThrottling(false)
})
require(path.join(root, 'out/main/index.js'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('TIMEOUT'); app.exit(1) }, 60000)
app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows()[0]
    if (win && !win.webContents.isLoading()) break
    await wait(100)
  }
  assert(win)
  win.setSize(1500, 1100)
  const js = (source) => win.webContents.executeJavaScript(source)
  for (let i = 0; i < 100; i++) {
    if (await js('!!(window.api && document.querySelector(".app"))')) break
    await wait(100)
  }
  const call = (name, ...args) => js('window.api.' + name + '(' + args.map((a) => JSON.stringify(a)).join(',') + ')')
  const png = fs.readFileSync(path.join(root, 'assets/brand/icon.png'))
  if (phase === 'seed') {
    const folder = await call('folders.create', '课程笔记')
    const note = await call('notes.create', '图片排版检查', folder.id)
    const legacy = await call('files.add', path.join(root, 'assets/brand/icon.png'), folder.id)
    const independent = await call('files.add', path.join(root, 'assets/brand/icon.png'), folder.id)
    const scheduled = await call('files.add', path.join(root, 'assets/brand/icon.png'), folder.id)
    await call('notes.addToReview', scheduled.id)
    const content = '# 图片排版检查\n\n第一行正文。\n第二行正文。\n\n普通段落间距保留。\n\n1. 反证法：\n\n\n![图片|100](xnote-file://' + legacy.id + ')\n\n\n2. Algebra 的定义：\n\n![图二|100](xnote-file://' + legacy.id + ')![图三|80](xnote-file://' + legacy.id + ')\n\n3. 下一条正文\n\n![已加入复习|60](xnote-file://' + scheduled.id + ')\n'
    await call('notes.saveContent', note.id, content)
    const annotation = await call('annotations.add', legacy.id, { type: 'rect', color: 'yellow', anchor: { text: '', prefix: '', suffix: '', locator: { type: 'rect', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, quote: '' })
    const Database = require('better-sqlite3')
    const db = new Database(path.join(profile, 'xnote.db'))
    db.prepare("DELETE FROM meta WHERE key = 'image_assets_organized_v1'").run()
    db.close()
    fs.writeFileSync(statePath, JSON.stringify({ folder: folder.id, note: note.id, legacy: legacy.id, independent: independent.id, scheduled: scheduled.id, annotation: annotation.id, content }))
    console.log('PASS seeded old inline image, independent image, scheduled image and annotation')
  } else {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const tree = await call('tree.list')
    const attachmentFolder = tree.find((n) => n.id === tree.find((item) => item.id === s.legacy).parent_id && n.kind === 'folder')
    assert(attachmentFolder)
    assert.equal(tree.find((n) => n.id === s.legacy).parent_id, attachmentFolder.id)
    assert.equal(tree.find((n) => n.id === s.independent).parent_id, s.folder)
    assert.equal(tree.find((n) => n.id === s.scheduled).parent_id, s.folder)
    assert.equal((await call('notes.getContent', s.note)).content, s.content)
    assert.equal((await call('annotations.list', s.legacy))[0].id, s.annotation)
    assert.deepEqual(Array.from(await call('files.getBytes', s.legacy)), Array.from(png))
    console.log('PASS existing inline image grouped; independent/review images unchanged; bytes, IDs, markdown and annotation preserved')
    const pasted = await js('window.api.files.addImage(' + JSON.stringify(s.note) + ', "粘贴图片 新增.png", new Uint8Array(' + JSON.stringify(Array.from(png)) + '))')
    assert.equal(pasted.parent_id, attachmentFolder.id)
    await call('tree.rename', attachmentFolder.id, '附件归档')
    const second = await js('window.api.files.addImage(' + JSON.stringify(s.note) + ', "拖入图片.png", new Uint8Array(' + JSON.stringify(Array.from(png)) + '))')
    assert.equal(second.parent_id, attachmentFolder.id)
    console.log('PASS pasted/dropped images reuse attachment folder even after rename')
    await js('localStorage.setItem("xnote.selectedId",' + JSON.stringify(s.note) + ');localStorage.removeItem("xnote.zoom.v2.markdown")')
    win.webContents.reload()
    await wait(1000)
    for (let i = 0; i < 100; i++) {
      if (await js('document.querySelectorAll(".cm-md-image img").length === 4')) break
      await wait(100)
    }
    for (const zoom of [100, 150]) {
      if (zoom !== 100) {
        await js('localStorage.setItem("xnote.zoom.v2.markdown",JSON.stringify({pct:' + zoom + '}))')
        win.webContents.reload()
        await wait(1200)
      }
      const layout = await js(`(() => {
        const c = document.querySelector('.md-editor .cm-content')
        const css = getComputedStyle(c)
        const fontSize = parseFloat(css.fontSize)
        const lineHeight = parseFloat(css.lineHeight)
        const imgs = [...c.querySelectorAll('.cm-md-image img')]
        const first = c.querySelector('.cm-md-image-line')
        const lines = [...c.querySelectorAll('.cm-line')]
        const before = lines.find((l) => l.textContent.includes('反证法'))
        const after = lines.find((l) => l.textContent.includes('Algebra'))
        const box = imgs[0].getBoundingClientRect()
        const fcss = getComputedStyle(first)
        const paragraphs = lines.filter((l) => l.textContent.includes('正文。'))
        return { fontSize, lineHeight, margin: parseFloat(fcss.marginTop),
          above: box.top - before.getBoundingClientRect().bottom,
          below: after.getBoundingClientRect().top - box.bottom,
          collapsed: lines.filter((l) => l.classList.contains('cm-md-collapsed')).length,
          paragraphGap: c.querySelector('.cm-md-gap').getBoundingClientRect().height,
          pairGap: imgs[2].getBoundingClientRect().top - imgs[1].getBoundingClientRect().bottom,
          source: c.cmTile.root.view.state.doc.toString()
        }
      })()`)
      const halfLeading = (layout.lineHeight - layout.fontSize) / 2
      assert(Math.abs(layout.margin - halfLeading) < 0.2)
      assert(layout.above >= halfLeading - 0.3 && layout.above < halfLeading + 1)
      // List-item top padding is existing typography, unchanged by the fix.
      assert(layout.below >= halfLeading - 0.3 && layout.below < halfLeading + layout.fontSize * 0.11 + 1)
      assert(Math.abs(layout.pairGap - (layout.lineHeight - layout.fontSize)) < 0.3)
      assert(layout.collapsed >= 6)
      assert(Math.abs(layout.paragraphGap - layout.fontSize * 0.95) < 0.3)
      assert.equal(layout.source, s.content)
      console.log('PASS ' + zoom + '% line rhythm ' + JSON.stringify({ above: layout.above, below: layout.below, betweenImages: layout.pairGap, ordinaryParagraph: layout.paragraphGap }))
    }
    fs.writeFileSync(path.join(process.env.XNOTE_TEST_ARTIFACT_DIR, 'attachments.png'), (await win.webContents.capturePage()).toPNG())
    await js(`document.querySelector('[aria-label="源码模式"]').click()`)
    await wait(300)
    assert.equal(await js('document.querySelectorAll(".cm-md-image-line").length'), 0)
    console.log('PASS source mode retains original blank lines and image syntax')
    console.log('ALL CHECKS PASSED')
  }
  clearTimeout(timeout)
  app.exit(0)
}).catch((error) => { console.error(error.stack); app.exit(1) })
