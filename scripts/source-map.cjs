const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
const files = walk(path.join(root, 'src')).sort()
const rows = files.map((file) => {
  const rel = path.relative(root, file).replaceAll('\\', '/')
  const text = fs.readFileSync(file, 'utf8')
  const imports = [], exports = []
  if (/\.(tsx?|js)$/.test(file)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith('.')) {
        imports.push((node.importClause?.isTypeOnly ? 'type: ' : '') + node.moduleSpecifier.text)
      }
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (node.name) exports.push(node.name.getText(source))
        if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) exports.push(d.name.getText(source))
        if (ts.isExportAssignment(node)) exports.push('default')
      }
    }
  }
  const link = '../' + rel
  return `| [${rel}](${link}) | ${text.split('\n').length} | ${exports.join(', ') || '—'} | ${imports.join(', ') || '—'} |`
})
fs.writeFileSync(path.join(root, 'docs/source-map.md'), '# Source map / 完整源码索引\n\nGenerated from current source by `node scripts/source-map.cjs`. All ' + files.length + ' source files are included. Type-only imports describe compile-time contracts, not runtime execution. HTML/script loading, re-exports, dynamic imports and IPC are not fully represented by this static table; see [architecture](architecture.md) for workflows. / 当前源码的静态索引；类型引用不是运行时调用，不能据此判断入口或旧代码可删除。\n\n| File / 文件 | Lines / 行数 | Exported declarations / 导出声明 | Direct local imports / 本地引用 |\n| --- | --- | --- | --- |\n' + rows.join('\n') + '\n')
console.log(`Generated source map: ${files.length} files`)
