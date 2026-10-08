# Note-Tracker-XNote — Usage guide / 使用指南

[English overview](../README.md) · [中文概览](../README.zh-CN.md) · [Validation / 验证记录](validation.md)

These instructions are for the owner and users with prior written permission. / 本文仅供作者及事先取得书面许可的使用者。参见 [Copyright / 著作权与授权](../COPYRIGHT.md)。

## 1. Try the core workflow / 核心操作示例

Create a Markdown note named **My first review** and paste the following text. / 新建同名 Markdown 笔记，粘贴以下文字。

```markdown
# My first review

Local notes are searchable.

- [ ] Recall this idea tomorrow
```

1. Wait for saving, switch notes and reopen. The text should remain. / 等待保存，切换后重新打开，文字应保留。
2. Highlight “Local notes” in annotation mode. The annotation should appear in the sidebar and survive a restart. / 标注模式中高亮文字，侧栏应出现标注，重启后仍保留。
3. Open today's review and rate the document. History should contain the rating; the next interval is at least one day. New Markdown notes enter review automatically; imported files require manual scheduling. / 今日复习中评分，历史应记录评分，下次间隔至少一天；新笔记自动加入，导入文件需手动加入。
4. Optional: select **Mock**, turn web search off and ask `总结《My first review》`. Expect a labelled simulated answer, not a real model interpretation. / 可选 Mock 演示应给出明确标注的模拟回答。

## 2. Run and package / 运行与打包

First complete the README's installation and native-module rebuild steps. / 先完成 README 中的依赖安装与原生模块重建。

| Goal / 目的 | Command / 命令 | Expected result / 预期结果 |
| --- | --- | --- |
| Development / 开发运行 | `npm run dev` | XNote window; source changes reload / 打开窗口，源码修改触发重新加载 |
| Build / 构建 | `npm run build` | Main, preload and renderer output in `out/` / 三层构建结果位于 `out/` |
| Run the build / 运行编译版本 | `npm start` | Desktop window using `out/` / 使用编译结果启动桌面窗口 |
| Offline checks / 离线验证 | `npm run verify` | `ALL VERIFICATION CHECKS PASSED` |

To run a compiled application / 编译运行：

```powershell
npm run build
npm start
```

`启动XNote.bat` is an alternative Windows launcher. It uses its own directory and builds if the compiled entry is absent; dependencies must already be installed and rebuilt. / Windows 启动脚本从自身目录启动，缺少编译入口时先构建；仍需提前安装依赖并重建原生模块。

For verified unpacked Windows packaging / 已验证的 Windows 解包流程：

```powershell
npm run pack:dir -- --config.win.signAndEditExecutable=false
npm run test:package
```

Output: `release/win-unpacked/XNote.exe`. The test launches that executable with a fresh profile and checks note saving/reading, native SQLite, resources and private-file exclusions. / 产物为上述程序；测试用独立配置启动，验证笔记读写、原生 SQLite、资源及私人文件排除。

The override disables signing and executable resource editing because extracting winCodeSign's symlinks failed on the tested Windows account. The Explorer executable icon may remain Electron's default; in-app branding remains. Full `npm run pack:dir` or `npm run dist:win` may require symbolic-link privileges. `dist:win` requests NSIS and portable executables; signed distribution, installer execution and portable execution remain unverified. / 覆盖参数关闭签名与程序资源编辑，以绕过本机符号链接权限问题；程序文件图标可能为 Electron 默认图标，软件内品牌保留。完整品牌打包可能需要符号链接权限；签名发行、安装器和便携版运行尚未验证。

## 3. Configure optional AI / 配置可选 AI

No `.env` or external database is required. Choose providers, models and keys in settings. / 无须 `.env` 或外部数据库；在设置页选择服务、模型并填写密钥。

| Option / 选项 | Behavior / 行为 |
| --- | --- |
| Mock | Functional demonstration without keys or paid calls; use web search off / 无密钥或付费请求的模拟演示，关闭联网搜索 |
| Chat / 聊天 | Adapters for OpenAI, DeepSeek, Anthropic and Google; verify current models with the provider / 已提供四种适配，实际模型以服务商为准 |
| Embeddings / 嵌入 | OpenAI and Google support real vectors; keyword search can work without embedding keys / 支持真实向量，无嵌入密钥时可用关键词搜索 |
| Vision and web search / 视觉与联网搜索 | Optional external services; require applicable keys, connectivity and potentially payment / 需相应密钥与网络，可能收费 |

Chat and embedding providers can differ. Build the library index in settings for semantic retrieval or image descriptions. Preset model names do not guarantee availability. Changing the embedding model can leave old hash-based index entries: clear the index before rebuilding. / 聊天与嵌入可选不同服务；语义检索或图片描述需在设置中建索引。预设模型名不保证可用；更换嵌入模型时先清空索引再重建。

“Current file” focuses chat context but does not disable library tools. Real services may receive document text, extracted images or search queries. Real chat, embedding, vision and Tavily/Brave calls were not tested with private credentials. / “当前文件”集中上下文，但不关闭全库工具；真实服务可能接收文档文字、提取图片或搜索请求。真实聊天、嵌入、视觉及 Tavily/Brave 未使用私人密钥验证。

## 4. Data and backup / 数据与备份

The library is local. Its profile is Electron `userData`, normally `%APPDATA%/xnote` on Windows. / 文件库在本地；配置位于 Electron `userData`，Windows 通常为上述目录。

| Path within the profile / 配置内路径 | Contents / 内容 |
| --- | --- |
| `xnote.db` | Item metadata, annotations, review history, index and chat records / 条目元数据、标注、复习历史、索引和聊天 |
| `notes/` | Markdown bodies / Markdown 正文 |
| `files/` | Copied imported files and images / 导入文件及图片副本 |
| `ai-settings.json`, `ai-keys.enc` | AI settings and protected/encoded keys / AI 设置及受保护或编码的密钥 |

Close the app and copy the **entire profile** for backup. The database alone does not contain note and file bytes. Some UI preferences use localStorage; migration database backups are not full-profile backups. Importing copies source files; visible folders are database relationships, not a mirror of disk directories. / 关闭软件后复制**整个配置目录**；单独数据库不含正文和文件。部分界面偏好使用 localStorage；迁移时的数据库备份也不是完整备份。导入会复制文件，界面文件夹是数据库关系，不是磁盘目录镜像。

Keys use Electron `safeStorage` when available. Its fallback is encoding, **not encryption**; settings show encryption availability. Never upload profiles, keys or personal exports. Normal source runs can share the existing profile; `npm test` uses fresh isolated profiles. / 优先使用系统密钥保护，回退编码**并非加密**；设置显示保护是否可用。不要上传个人配置、密钥或导出；普通源码运行可能共用已有配置，`npm test` 使用独立新配置。

## 5. Troubleshooting / 排错

| Symptom / 情况 | Action / 处理 |
| --- | --- |
| SQLite / ABI mismatch | Run `npm run rebuild`; if rebuilding fails, check Python/C++ build prerequisites / 重建原生模块，失败时检查编译环境 |
| Built app misses source changes / 编译运行未体现修改 | Run `npm run build` again, or use `npm run dev` / 重新构建或使用开发运行 |
| AI key/model/network error / AI 密钥、模型或网络错误 | Test the provider in settings; choose an available model or Mock with web search off / 在设置中测试服务，或使用关闭联网的 Mock |
| Old results after changing embeddings / 更换嵌入后仍有旧结果 | Clear the index and rebuild it / 清空后重建索引 |
| Packaging symlink error / 打包符号链接错误 | Use the verified override above, or an appropriately configured build account / 使用上面的验证参数或配置适当的构建账户 |

DOCX is converted to reading HTML; spreadsheets display at most 2,000 rows. These are viewers, not full Office editors. There is no scanning OCR, cloud sync or automatic updater. / DOCX 转换为阅读 HTML，表格最多显示 2,000 行；不是完整 Office 编辑器，尚无扫描 OCR、云同步或自动更新。

## 6. Names and repository scope / 名称与仓库范围

**Note-Tracker-XNote** is the project and repository name. Internal package name `xnote`, application name `XNote`, app ID `com.xnote.app`, protocols, database filenames, launcher and executable retain their existing names to preserve startup and stored-data compatibility. Renaming the project does not migrate user data or change functionality. / 新名称用于项目和仓库；内部包名、应用名、应用 ID、协议、数据库文件、启动脚本及程序文件名沿用原值，以保持启动和已有数据兼容。此次改名不迁移数据，也不改变功能。

The repository contains source, locked dependencies, configs, offline tests and documentation. `.shots`, historical context ZIPs, installed dependencies, outputs, old installers and private diagnostics remain local and excluded. No uncertain old implementation is deleted. / 仓库包含源码、依赖锁、配置、离线测试和文档；旧实验、上下文 ZIP、安装依赖、生成结果、旧安装器及私人诊断本地保留但排除，不删除用途不明的旧实现。

For coverage, retained dependency vulnerabilities and unverified platforms, see [validation](validation.md). For source navigation and data flow, see [architecture](architecture.md) and [the complete source map](source-map.md). / 验证范围、依赖漏洞及未验证平台见验证记录；代码关系见架构与完整源码索引。
