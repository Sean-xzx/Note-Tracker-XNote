# Resources and third-party software / 资源与第三方软件

## Project resources / 项目资源

`assets/brand/` contains the existing XNote icons, SVG marks and motion reference supplied with this personal project. They are retained as project resources; no downloaded illustration, personal course screenshot, dataset, model weight or user-imported document is added. `docs/images/demo.png` is captured by the bundled test using synthetic text. / 保留原项目品牌资源，演示截图使用合成文字；未添加下载插画、个人课程截图、数据集、模型权重或用户文件。

The original package metadata says MIT; full project licensing awaits owner confirmation. Third-party package licenses remain separate. / 原包声明 MIT，完整项目许可证待作者确认；第三方许可证独立适用。

## Direct runtime packages / 直接运行依赖

Versions and declared licenses below were read from installed package metadata and compared with the lockfile. This is navigation, not a replacement for their full license texts or transitive notices. Install with `npm ci` and retain applicable licenses when redistributing packaged software. / 下表来自包元数据，不替代许可证全文及间接依赖声明；重新分发时保留适用许可。

| Package group / 依赖 | Version / 版本 | Declared license / 声明 |
| --- | --- | --- |
| CodeMirror autocomplete/commands/lang-markdown/language/search/state/view | See lockfile / 见锁文件 | MIT |
| Lezer highlight/markdown | 1.2.3 / 1.7.2 | MIT |
| Floating UI React | 0.27.20 | MIT |
| better-sqlite3 | 11.10.0 | MIT |
| ts-fsrs / FSRS native binding | 5.4.2 / 0.5.0 | MIT |
| DOMPurify | 3.4.15 | MPL-2.0 OR Apache-2.0 |
| KaTeX / lowlight | 0.18.7 / 3.3.0 | MIT |
| Lucide React | 1.47.0 | ISC |
| Mammoth | 1.12.3 | BSD-2-Clause |
| marked / Mermaid | 18.0.13 / 11.17.2 | MIT |
| PDF.js (`pdfjs-dist`) | 4.7.76 | Apache-2.0 |
| perfect-freehand | 1.2.3 | MIT |
| react-markdown | 9.1.0 | MIT |
| rehype-highlight/katex/sanitize, remark-gfm/math | See lockfile / 见锁文件 | MIT |
| SheetJS (`xlsx`) | 0.18.5 | Apache-2.0 |

React/ReactDOM, Electron, TypeScript, Vite/electron-vite, electron-builder and their dependencies also retain their own licenses, found in installed package directories. The existing dependency set is retained without a broad upgrade. / React、Electron 和开发工具亦有各自许可，本次未整体升级依赖。

Useful upstream references / 上游说明: [CodeMirror](https://codemirror.net/), [Electron](https://www.electronjs.org/), [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), [PDF.js](https://github.com/mozilla/pdf.js), [Mammoth](https://github.com/mwilliamson/mammoth.js), [SheetJS](https://git.sheetjs.com/sheetjs/sheetjs).

External models/search services are optional network services, not bundled model resources. Their credentials, costs and outputs are outside the project license. / 外部模型及搜索是可选服务，不是仓库内模型资源，其密钥、费用和输出不由项目许可证覆盖。
