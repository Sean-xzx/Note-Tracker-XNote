const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
let files
let hasGitIndex = false
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean)
  hasGitIndex = true
} catch {
  files = ['src', 'assets', 'scripts', 'tests', '.github'].flatMap((d) => walk(path.join(root, d)).map((p) => path.relative(root, p).replaceAll('\\', '/')))
  files.push(...['docs/architecture.md', 'docs/usage.md', 'docs/validation.md', 'docs/THIRD_PARTY.md', 'docs/images/demo.png'])
  files.push(...fs.readdirSync(root).filter((p) => fs.statSync(path.join(root, p)).isFile()))
}
assert(files.length > 0, 'No repository files found')
const forbidden = /(^|\/)(node_modules|out|release|\.shots|\.claude|test-results|validation-local)(\/|$)|(^|\/)\.env($|\.)|\.(db|db-wal|db-shm|log|zip|exe|bak)$/i
const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|password|secret)\s*[:=]\s*["'][^"'\s]{12,}["']/i
]
for (const file of files) {
  assert(!forbidden.test(file), `Private/generated file in publication: ${file}`)
  const full = path.join(root, file)
  assert(fs.existsSync(full), `Missing file: ${file}`)
  assert(fs.statSync(full).size < 5 * 1024 * 1024, `Unexpected large file: ${file}`)
  if (/\.(png|ico)$/.test(file)) continue
  const text = fs.readFileSync(full, 'utf8')
  assert(!secretPatterns.some((p) => p.test(text)), `Potential credential in ${file}; inspect privately`)
  assert(!/[A-Z]:[\\/]Users[\\/]/i.test(text), `Machine-specific user path in ${file}`)
  if (hasGitIndex) {
    const staged = execFileSync('git', ['show', ':' + file], { cwd: root, encoding: 'utf8' })
    assert(!secretPatterns.some((p) => p.test(staged)), `Potential credential in staged ${file}; inspect privately`)
    assert(!/[A-Z]:[\\/]Users[\\/]/i.test(staged), `Machine-specific user path in staged ${file}`)
  }
  if (/\.md$/.test(file)) {
    for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = m[1].split('#')[0]
      if (!href || /^(https?:|mailto:)/.test(href)) continue
      assert(fs.existsSync(path.resolve(path.dirname(full), decodeURIComponent(href))), `Broken link in ${file}: ${href}`)
    }
  }
}
for (const name of ['README.md', 'README.zh-CN.md', 'COPYRIGHT.md', 'package-lock.json', '.github/workflows/ci.yml']) {
  assert(files.includes(name), `Required file not tracked: ${name}`)
}
assert(fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes('(README.zh-CN.md)'))
assert(fs.readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8').includes('(README.md)'))
const commands = (name) => [...fs.readFileSync(path.join(root, name), 'utf8').matchAll(/```(?:powershell|markdown)\n([\s\S]*?)```/g)].map((m) => m[1])
assert.deepEqual(commands('README.md'), commands('README.zh-CN.md'), 'Bilingual commands/examples must match')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
for (const kind of ['dependencies', 'devDependencies', 'engines', 'license']) {
  assert.deepEqual(pkg[kind], lock.packages[''][kind], `Lock metadata mismatch: ${kind}`)
}
assert.equal(pkg.license, 'UNLICENSED', 'Project metadata must not grant an open-source license')
assert(!files.includes('LICENSE'), 'Obsolete project license must not be published')
console.log(`PASS publication inventory, credential/path checks, README links and lock metadata (${files.length} files)`)
console.log('Pattern checks complement manual review; they are not a guarantee that every secret is detectable.')
