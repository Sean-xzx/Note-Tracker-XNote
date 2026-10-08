# Note-Tracker-XNote

[简体中文](README.zh-CN.md) · [Usage](docs/usage.md) · [Architecture](docs/architecture.md) · [Validation](docs/validation.md)

**A personal desktop project connecting note-taking, document annotation and spaced repetition in one local library.**

## Value: turn study material into a review workflow

Course notes, reading annotations and review plans often live in separate tools. Note-Tracker-XNote brings them together: **write or import → annotate → review → record feedback**. The aim is to revisit the original material alongside its annotations, rather than maintain a separate set of review cards. AI search and document questions are optional.

## My contribution: an integrated desktop application

As the project author, I implemented the following application workflows using **Electron, React, TypeScript, CodeMirror 6 and SQLite**:

| Work delivered | Engineering skills demonstrated |
| --- | --- |
| A unified library for Markdown and imported documents, with folders, moves and trash restore | Desktop UI, IPC design and persistent data modeling |
| Live Markdown editing, document viewers and separately stored annotations | Editor integration, source-to-display mapping and file handling |
| Whole-document review with four ratings, reflections, folder settings, exam dates and daily budgets | Scheduling constraints and state/history management |
| Optional document-search and question-answering tools, streaming responses and saved conversations | Provider adapters, tool orchestration and retrieval integration |

Implementation references: [library](src/main/notes.ts), [editor](src/renderer/src/components/MdEditor.tsx), [review](src/main/review.ts) and [AI agent](src/main/aiAgent.ts). [Architecture](docs/architecture.md) explains how these modules cooperate.

## Method: the key design choices

- **One document identity across workflows.** Editing, annotations, review and AI refer to the same item ID. SQLite holds metadata and history; local files hold document content. Annotations are stored separately from the original files.
- **Adapt FSRS to course material.** The memory model comes from `ts-fsrs`; the application adds whole-day intervals, inherited folder parameters, exam-date constraints and review budgets. See [scheduling](src/main/fsrs.ts) and [review queues](src/main/review.ts).
- **Preserve source text while rendering it.** Markdown preview decorates the editable source. Saving replays edits onto the original text to preserve untouched BOM and line endings; annotations map between source and display positions. See [editor](src/renderer/src/components/MdEditor.tsx) and [anchors](src/renderer/src/lib/md/anchors.ts).
- **Make AI an optional layer.** The agent can list, search and read library documents, stream answers and return sources. Keyword search and Mock demonstrations work without paid model keys. See [agent](src/main/aiAgent.ts) and [index](src/main/aiIndex.ts).

## Results: a running application and reproducible checks

![Actual application with synthetic Markdown notes](docs/images/demo.png)

- **Working desktop workflow:** note save/read, annotations, review ratings/history and Mock chat persistence were checked in real Electron processes, including after restart.
- **Data and layout checks:** Markdown import bytes, attachment grouping and image spacing at 100%/150% zoom passed regression checks.
- **Clean installation and packaging:** a fresh GitHub clone was installed and tested on Windows; the unpacked executable started and saved/read a note. See [validation](docs/validation.md) and [current CI](https://github.com/Sean-xzx/Note-Tracker-XNote/actions).

The screenshot uses synthetic notes, not private data. These are functional results; learning gains, user-study outcomes and performance improvements have not been measured.

## Run and verify

For the owner and users with prior written permission. Tested environment: **Windows 11 x64, Node.js 22.23.2, npm 10.9.8, Electron 33.4.11**. Install Git and Node.js first; dependency installation needs internet access. If native binaries are unavailable, Python 3 and Visual Studio C++ Build Tools may be needed.

```powershell
git clone https://github.com/Sean-xzx/Note-Tracker-XNote.git
cd Note-Tracker-XNote
npm ci --no-audit --no-fund
npm run rebuild
npm run dev
```

Success: the XNote desktop window opens with the library, review navigation and settings. Basic note-taking, annotations and review require no API key. The project name is Note-Tracker-XNote; existing application and storage identifiers remain unchanged for compatibility.

```powershell
npm run verify
```

Success: `ALL VERIFICATION CHECKS PASSED`. Tests use isolated profiles; logs and a regenerated screenshot go to `test-results/`. Compiled runs, packaging and a step-by-step example are in the [usage guide](docs/usage.md).

## Scope and further reading

Current version: **0.1.0**, personally maintained with no guaranteed support schedule. Review operates on whole documents; cloud sync and scanned-PDF OCR are not implemented. Other platforms, paid AI services and signed installers are unverified. The retained production dependency tree had **14 audit entries (1 critical, 4 high, 3 moderate, 6 low)** on 2026-10-08; see [validation](docs/validation.md).

| Question | Documentation |
| --- | --- |
| How do I configure, back up, package or troubleshoot it? | [Usage guide](docs/usage.md) |
| Where are the entry points, module boundaries and data flows? | [Architecture](docs/architecture.md) |
| What does each source file contain and import? | [Complete source map](docs/source-map.md) |
| Which checks passed, and what remains untested? | [Validation record](docs/validation.md) |

**All rights reserved.** Public visibility is for inspection; other use or modification requires prior written permission, subject to applicable law and GitHub's terms. [Copyright notice](COPYRIGHT.md) explains the prior MIT-publication boundary; [third-party notices](docs/THIRD_PARTY.md) cover dependency licenses and resource origins. Report problems or request permission through [Issues](https://github.com/Sean-xzx/Note-Tracker-XNote/issues); do not attach profiles, keys or private files.
