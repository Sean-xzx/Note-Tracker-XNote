# Note-Tracker-XNote

[English](README.md) · [使用指南](docs/usage.md) · [架构说明](docs/architecture.md) · [验证记录](docs/validation.md)

**一个将笔记、文档标注和间隔复习连接到同一本地文件库的个人桌面项目。**

## 项目价值：让学习资料进入复习流程

课程笔记、阅读标注和复习计划往往分散在不同工具中。本项目将它们串成 **记录或导入 → 标注 → 复习 → 记录反馈** 的流程，让用户带着标注回看原始资料，无须另建一套复习卡片。AI 搜索和文档问答作为可选辅助。

## 我的贡献：完成一套协同工作的桌面应用

作为项目作者，我使用 **Electron、React、TypeScript、CodeMirror 6 和 SQLite** 完成了以下业务流程：

| 完成的工作 | 体现的工程能力 |
| --- | --- |
| 统一管理 Markdown 与导入文档，支持文件夹、移动和回收站恢复 | 桌面界面、IPC 接口设计与持久化数据建模 |
| 实现实时 Markdown 编辑、文档阅读器和独立存储的标注 | 编辑器集成、源码与显示位置映射、文件处理 |
| 实现整篇文档复习，连接四档评分、心得、文件夹参数、考试日期和每日预算 | 调度约束与状态、历史记录管理 |
| 接入可选文档搜索与问答工具，支持流式回答和会话保存 | 服务适配、工具编排与检索集成 |

实现依据：[文件库](src/main/notes.ts)、[编辑器](src/renderer/src/components/MdEditor.tsx)、[复习业务](src/main/review.ts) 和 [AI Agent](src/main/aiAgent.ts)。模块如何协作见 [架构说明](docs/architecture.md)。

## 技术方法：关键设计取舍

- **用同一文档身份连接各环节。** 编辑、标注、复习和 AI 共用条目 ID；SQLite 保存元数据与历史，本地文件保存正文。标注与原始文件分开存储。
- **把 FSRS 适配到课程资料。** 记忆模型来自 `ts-fsrs`；项目加入整天间隔、文件夹参数继承、考试日期约束和复习预算。见 [调度规则](src/main/fsrs.ts) 与 [复习队列](src/main/review.ts)。
- **在实时预览中保留原始文本。** Markdown 预览装饰可编辑源码；保存时将编辑操作回放到原文，保留未修改的 BOM 和换行。标注在源码与显示位置间映射。见 [编辑器](src/renderer/src/components/MdEditor.tsx) 与 [定位映射](src/renderer/src/lib/md/anchors.ts)。
- **让 AI 成为可选层。** Agent 按需列举、搜索、读取文档，流式返回回答和来源；关键词搜索及 Mock 演示无需付费模型密钥。见 [Agent](src/main/aiAgent.ts) 与 [索引](src/main/aiIndex.ts)。

## 成果证据：可运行的软件与可复现检查

![真实应用中的合成 Markdown 笔记](docs/images/demo.png)

- **桌面业务流程跑通：** 在真实 Electron 进程中验证了笔记读写、标注、复习评分与历史、Mock 聊天持久化，并检查了重启后的数据。
- **数据与布局回归通过：** 验证了 Markdown 导入字节、图片附件归档，以及 100%／150% 缩放下的图片间距。
- **干净安装与打包验证通过：** 从 GitHub 重新克隆，在 Windows 上安装并测试；解包程序实际启动并完成笔记读写。见 [验证记录](docs/validation.md) 和 [最新 CI](https://github.com/Sean-xzx/Note-Tracker-XNote/actions)。

截图使用合成笔记，不含私人数据。上述证据属于功能验证；尚未测量学习效果、用户研究结果或性能提升。

## 运行与验证

仅供作者及事先取得书面许可的使用者。已验证环境：**Windows 11 x64、Node.js 22.23.2、npm 10.9.8、Electron 33.4.11**。先安装 Git 和 Node.js；安装依赖需要联网。若原生模块预编译文件不可用，可能还需 Python 3 和 Visual Studio C++ Build Tools。

```powershell
git clone https://github.com/Sean-xzx/Note-Tracker-XNote.git
cd Note-Tracker-XNote
npm ci --no-audit --no-fund
npm run rebuild
npm run dev
```

成功标志：出现 XNote 桌面窗口，包含文件库、复习导航和设置。基本笔记、标注和复习无需 API 密钥。项目名为 Note-Tracker-XNote；应用及存储标识沿用原值，以保持兼容。

```powershell
npm run verify
```

成功标志：`ALL VERIFICATION CHECKS PASSED`。测试使用独立配置，日志和重新生成的截图位于 `test-results/`。编译运行、打包及操作示例见 [使用指南](docs/usage.md)。

## 项目边界与阅读入口

当前版本 **0.1.0**，个人维护，没有承诺支持时间表。复习以整篇文档为单位；尚未实现云同步和扫描 PDF 的 OCR。其他平台、付费 AI 服务和签名安装器未验证。截至 2026-10-08，保留的生产依赖树有 **14 项审计记录（1 严重、4 高危、3 中危、6 低危）**，详见 [验证记录](docs/validation.md)。

| 想了解什么 | 文档 |
| --- | --- |
| 如何配置、备份、打包和排错？ | [使用指南](docs/usage.md) |
| 入口、模块边界和数据流在哪里？ | [架构说明](docs/architecture.md) |
| 每个源码文件包含什么、引用什么？ | [完整源码索引](docs/source-map.md) |
| 哪些检查通过，哪些内容未验证？ | [验证记录](docs/validation.md) |

**保留所有权利。** 公开展示用于查看；其他使用或修改须事先取得书面许可，但以适用法律和 GitHub 条款为准。[著作权声明](COPYRIGHT.md) 说明此前 MIT 发布的边界；[第三方说明](docs/THIRD_PARTY.md) 记录依赖许可证及资源来源。通过 [Issues](https://github.com/Sean-xzx/Note-Tracker-XNote/issues) 报告问题或申请授权，不要附上个人配置、密钥或私人文件。
