# Validation / 验证记录

Snapshot date / 记录日期: **2026-10-08**. Environment / 环境: Windows 11 Home x64 (10.0.26200), Node 22.23.2, npm 10.9.8, Electron 33.4.11.

## Baseline and preservation / 原版本与保护

- Before editing, a full external backup preserved source, ignored files, installed dependencies, built outputs, releases and local test profiles. It is deliberately absent from the public repository. / 修改前建立了项目外完整备份，不上传公开仓库。
- Baseline TypeScript checks and the existing attachment/layout regression passed against the original build in a separate temporary profile. / 原版本类型检查及隔离的附件布局回归通过。
- This preparation changes documentation, development/verification tools, package metadata, launcher and packaging inclusion. Application files under `src/` are protected by comparison with the original SHA-256 manifest. / 本次整理不修改核心源码，使用原始 SHA-256 清单核对。

## Reproduction / 复现

```powershell
npm ci --no-audit --no-fund
npm run rebuild
npm run verify
npm run pack:dir -- --config.win.signAndEditExecutable=false
npm run test:package
```

`npm test` starts real Electron processes with fresh temporary profiles and no private keys. The general runtime test blocks main-process network access and explicitly chooses Mock; the attachment test uses only the bundled brand image. Existing real user profiles are never selected. / 自动测试使用真实 Electron、独立临时配置和无密钥 Mock，不访问个人配置。

| Test / 测试 | Assertions / 验证内容 |
| --- | --- |
| `runtime.cjs seed` | New DB/UI, Markdown round-trip, BOM/CRLF import bytes, text edit, annotation, FSRS queue/preview/rating/reflection, invalid folder cycle, trash restore, keyword indexing/search, mock agent read tool and stream, saved messages / 新数据和主要业务链 |
| `runtime.cjs verify` | Restarted content, file bytes, annotations, review history, settings, chats and visible CodeMirror source; synthetic screenshot / 重启持久化与真实界面 |
| `attachments.cjs seed` | Referenced, independent and scheduled image fixtures plus a region annotation / 图片测试样本 |
| `attachments.cjs verify` | One-time organization, stable IDs/bytes/annotation/Markdown, folder rename reuse, 100%/150% spacing and source mode / 附件整理与图片布局 |
| `check-repo.cjs` | Tracked publication scope, suspicious credential literals, private absolute paths, size limits, local Markdown links and lock metadata / 发布清单与文档检查 |
| `check-package.cjs` | ASAR entries, private-file exclusions, unpacked native SQLite and icon, actual executable boot with isolated profile and note save/read / 包内清单及真实程序运行 |

Expected final message: `ALL VERIFICATION CHECKS PASSED`; a failure exits nonzero. Logs and `summary.json` are in ignored `test-results/`; temporary profiles are retained at the printed path. GPU driver diagnostics can appear on this host without an assertion failure; they are not presented as application feature errors. / 失败返回非零，日志不公开；本机可能出现不影响断言的 GPU 驱动诊断。

The test is functional reproduction, not an exhaustive viewer/security test or pixel-identical snapshot test. Random UUIDs, current-day review dates, OS scale/fonts and installed graphics drivers affect outputs. / 这是功能复现，非全面覆盖或像素一致性测试。

## Current evidence / 当前证据

Completed locally on the stated platform: baseline checks; current `npm run verify`; a clean publication-only directory with fresh npm/Electron download caches, `npm ci --no-audit --no-fund`, `npm run rebuild`, and `npm run verify`. `npm start` and `npm run dev` also launched the actual UI, using an external test entry solely to set a fresh profile and suppress the visible window. Their respective file/HTTP page URLs and empty library were asserted. Unpacked-package verification is tracked separately. / 本机已完成原版和新版验证、只含发布文件的干净目录安装与重建验证；编译版和开发模式实际启动界面。启动验证仅用外部测试入口隔离配置和隐藏窗口，检查 file/HTTP 页面及空文件库。解包应用另行记录。

GitHub Actions is configured for Windows checks, runtime tests and unpacked packaging. A workflow file alone is not a passing workflow; inspect the actual repository run. / 已配置自动验证，但配置存在不代表远程运行通过。

Default unpacked packaging reached the application assembly stage but failed to extract winCodeSign's macOS symlinks due to this Windows user's symbolic-link privilege. The documented verification command disables executable signing/resource editing; it does not change the application source or full distribution configuration. Full branded executable/installer packaging remains unverified. / 默认解包流程在签名工具解压时受到本机符号链接权限限制；验证命令仅关闭可执行文件签名/资源编辑，保留核心源码及完整发行配置。完整品牌程序/安装器打包仍未验证。

The unpacked application was then built successfully with the documented override. ASAR entrypoints, the splash script, bundled window icon, unpacked SQLite binary and exclusion of project-private directories/files were asserted. The actual `XNote.exe` launched with an explicit temporary profile, showed the React UI, created its isolated database and saved/read a note through IPC. `check-package.cjs` exited successfully. / 覆盖参数下解包成功，包内资源与排除规则通过检查；真实 XNote.exe 使用临时配置启动并完成笔记读写，包验证脚本成功退出。

The lockfile's Electron node-gyp Git URL was changed from SSH to HTTPS while retaining the exact commit. `@electron/asar` 3.4.1, already present in the locked builder dependency tree, is now explicitly declared as a development dependency for package verification. Existing dependency versions and all 82 application source files remain unchanged. / 仅把同一 node-gyp 提交的获取地址改为 HTTPS，并明确声明原已锁定的 ASAR 测试工具；原依赖版本及 82 个核心源码文件不变。

The final dependency metadata was also installed with separate empty npm/Electron caches, empty npm user/global configuration, and Git system/global configuration disabled. Anonymous public HTTPS access was checked; installation, native rebuilding and the complete verification pipeline passed without the author's Git credentials or private npm settings. / 最终依赖元数据又在空缓存、空 npm 配置及禁用 Git 系统/全局配置的条件下安装，公开 HTTPS 获取、原生重建和完整验证通过，不依赖作者私人 Git 认证或 npm 设置。

## Unverified / 未验证

`npm audit --omit=dev --json` on the retained lockfile reported 14 vulnerability entries: 1 critical, 4 high, 3 moderate and 6 low. Directly named dependencies include DOMPurify, Mammoth, Mermaid, PDF.js, rehype-katex, remark-math and xlsx; the critical entry is transitive `tar`. These are npm's dependency-level results, not a demonstrated exploit in XNote. No automatic fix or dependency replacement was applied because this task preserves the existing application behavior. / 生产依赖审计有 14 项记录，严重项为间接 tar；未进行自动修复或替换依赖，也未宣称已安全加固。Raw audit evidence stays in local ignored test artifacts. / 原始结果保留在本地测试资料中。

- Real chat, embeddings, vision and Tavily/Brave: no private credentials or paid calls used. / 未使用私人密钥或付费请求。
- Exhaustive PDF/DOCX/spreadsheet import and rendering, all annotation gestures, every optimizer/migration scenario and very large file behavior. / 未穷尽格式、交互、优化、迁移及大文件情况。
- Linux/macOS/ARM, signed distribution, NSIS install/uninstall and portable executable execution. / 其他平台、签名及安装器/便携包运行未验证。
- Strict binary/screenshot reproducibility, performance guarantees and current security of every retained dependency. / 未承诺产物完全一致、性能或依赖安全。

## Published and retained scope / 发布与保留范围

Publish source, exact dependency lock, build configs, portable offline tests, current docs and project brand resources. Retain but exclude `.shots`, old context docs/ZIP, installed dependencies, outputs, installers, profile databases and diagnostics. No uncertain old code is deleted. / 发布必要代码和资源，旧实验及个人资料本地保留但排除；不删除用途不明代码。
