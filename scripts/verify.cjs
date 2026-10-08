const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
if (!fs.existsSync(path.join(root, 'out/main/index.js'))) {
  console.error('Build first: npm run build')
  process.exit(1)
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xnote-verification-'))
const artifacts = path.resolve(process.env.XNOTE_TEST_ARTIFACT_DIR || path.join(root, 'test-results'))
fs.mkdirSync(artifacts, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (key.startsWith('XNOTE_')) delete env[key]
env.XNOTE_TEST_ARTIFACT_DIR = artifacts
const electron = require('electron')
let failed = false
const results = []
for (const [file, phase, profile] of [
  ['runtime.cjs', 'seed', 'runtime'],
  ['runtime.cjs', 'verify', 'runtime'],
  ['attachments.cjs', 'seed', 'attachments'],
  ['attachments.cjs', 'verify', 'attachments']
]) {
  env.XNOTE_TEST_PROFILE = path.join(work, profile)
  fs.mkdirSync(env.XNOTE_TEST_PROFILE, { recursive: true })
  const run = spawnSync(electron, [path.join(root, 'tests', file), phase], {
    cwd: root, env, encoding: 'utf8', timeout: 90000, windowsHide: true
  })
  const output = (run.stdout || '') + (run.stderr || '')
  const label = `${path.basename(file, '.cjs')}-${phase}`
  fs.writeFileSync(path.join(artifacts, `${label}.log`), output)
  process.stdout.write(output)
  if (run.error) console.error(run.error.message)
  const ok = !run.error && run.status === 0 && /PASS/.test(output)
  results.push({ test: label, exitCode: run.status, ok })
  if (!ok) { failed = true; break }
}
fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify({
  at: new Date().toISOString(), platform: process.platform, arch: process.arch,
  node: process.version, profileDirectory: work, results
}, null, 2))
console.log(`Isolated test data: ${work}`)
console.log(`Test artifacts: ${artifacts}`)
if (failed) process.exit(1)
console.log('ALL VERIFICATION CHECKS PASSED')
