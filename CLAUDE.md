# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vault Reader: a local-first Markdown reader/editor for Windows with an Obsidian-style workspace (file tree, tabs, wiki links, backlinks, outline). Vanilla JS with no bundler, no TypeScript, and no framework. Notes are plain `.md` files on disk; there is no database.

## Commands

```powershell
npm install
npm run start            # copy vendor libs, then launch the Electron shell
npm run build:web        # assemble web-dist/ (Tauri's frontendDist) from index.html, app.js, styles.css, vendor/
npm run build:light      # Tauri build -> dist/Vault-Reader-light-0.1.0.exe (needs a Rust toolchain)
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run build:portable   # electron-builder -> dist/Vault-Reader-0.1.0-portable.exe
```

- `npm run copy-vendor` copies `purify.min.js`, `marked.min.js`, and `lucide.min.js` from `node_modules` into `vendor/`. `vendor/`, `web-dist/`, `dist/`, and `src-tauri/target/` are generated and gitignored. If `vendor/` is missing the app still boots but silently falls back to the hand-rolled `miniMarkdown()` renderer and Lucide icons do not render.
- `npx tauri dev` runs the Tauri shell in development (no npm script). `tauri.conf.json`'s `beforeDevCommand` rebuilds `web-dist/` first, so renderer edits need a restart: there is no dev server or HMR in either shell.
- There is no test suite, linter, or type checker. Verification is manual: run a shell and exercise the UI.

## Architecture

### One renderer, three hosts

`index.html` + `app.js` + `styles.css` are the entire UI and run unchanged under three hosts. `app.js` picks the backend **per call**, in this fixed order:

1. Electron: `window.vaultReaderNative`, exposed by `preload.js` via `contextBridge` and backed by `ipcMain.handle("vault:...")` handlers in `main.js`.
2. Tauri 2: `window.__TAURI__.core.invoke` (`withGlobalTauri: true`); commands live in `src-tauri/src/lib.rs`.
3. Browser: the File System Access API (`showDirectoryPicker`), falling back to the hidden `<input webkitdirectory>` / `<input type=file>` elements.

That detection is repeated inside `openFolder`, `openFiles`, `openVaultPath`, `listNativeFolder`, `readEntryText`, `writeDiskFile`, and `createPersistedNote`. Adding a native capability therefore means touching **three places**: an `ipcMain.handle` in `main.js` plus a matching method in `preload.js`; a `#[tauri::command]` in `lib.rs` registered in `generate_handler!`; and the fallback chain in `app.js`. Tauri currently has no `open_external`, so http(s) links are only routed to the OS browser under Electron.

### Native result contract

`main.js` and `lib.rs` are deliberate ports of each other and must return identical JSON:

- Open results: `{ vaultName, rootPath | null, selectedId?, folders: string[], files: FileEntry[] }`
- `FileEntry`: `{ id: "disk:<absolutePath>", absolutePath, path, name, title, directory, text: null, size, created, modified, isDisk }`, where `path` is vault-relative with forward slashes.
- Folder navigator (`list-folder` / `list_folder`): `{ path, name, parentPath, roots, folders }`.

The Rust structs use `#[serde(rename = "...")]` to emit camelCase. Vault-walking rules are duplicated in `main.js`, `lib.rs`, and `app.js`: recurse the folder, skip `.git`, `.obsidian`, `node_modules`, and `.trash`, accept only `.md` / `.markdown` / `.mdown`. Note-name sanitizing and the "Name 2.md" uniquing loop are also duplicated in both shells. Change every copy together.

### File entries and lazy text

`state.files` holds every note in the open vault. The `id` prefix records where the bytes come from, and `readEntryText()` resolves them in this order: cached `text` → `handle.getFile()` (`handle:`) → the `File` object (`folder:` / `file:`) → native `readFile` (`disk:`) → `""`. New notes with no writable backend become `draft:` entries; `sample:field-notes` is the built-in welcome note loaded at boot.

After a vault opens, `indexFilesInBackground()` reads every note's text sequentially (yielding every 15 files) so "Linked mentions" can be computed by regex-scanning all texts in memory (`updateBacklinks` / `noteMentions`). Until it finishes, `state.indexed` is false and the inspector shows "Indexing notes."

### Editing model: Live mode is a DOM-to-Markdown round trip

`file.text` is the source of truth. Three views are switched by the `data-view` attribute on `#appShell` plus CSS:

- **Source** edits the `<textarea id="sourceText">`; the preview re-renders on a 120 ms debounce.
- **Live** and **Split** edit the rendered HTML inside the `contenteditable` `#markdownView`. On every input, `markdownFromEditor()` walks the DOM back into Markdown (`blockToMarkdown`, `listMarkdownFromNode`, `tableMarkdownFromNode`, `inlineMarkdownFromNode`) and writes the result to both `file.text` and the textarea.

Consequently any Markdown construct the reverse converter does not handle is **lost or rewritten** the moment a user types in Live mode. When extending rendering, extend the reverse converter in the same change. Wiki links survive because `transformWikiLinks()` renders `[[Target|alias]]` as `<a href="#wiki:Target">` and the converter turns `#wiki:` hrefs back into `[[...]]`. `getCurrentMarkdownText()` decides which surface is authoritative on save by checking which one has focus.

Rendering pipeline: `transformWikiLinks` → `marked.parse` (GFM) → `DOMPurify.sanitize` → `innerHTML`, then `decorateRenderedNote` builds the outline and details. Live line numbers are heuristic: `extractLiveLineMarkers()` maps source line numbers onto top-level rendered blocks from `getLiveLineAnchors()` and absolutely positions gutter spans, so they depend on marked's block structure matching the marker heuristics.

### "Open with" and file association

Both shells accept `.md` paths on the command line. Electron holds a single-instance lock; `main.js` sends paths on first load and on `second-instance` through the `vault:opened-files` event. Tauri collects `markdown_args()` and injects them with `window.eval`, which sets `__VAULT_READER_TAURI_OPEN_PATHS` and dispatches the `vault-reader-open-paths` event; `wireNativeOpenEvents()` handles both the pre-set global and the event because ordering is not guaranteed. If all paths share one parent folder, that folder opens as the vault with the file selected; otherwise a `rootPath: null` "Loose files" vault opens with every file as a tab.

### Persistence

All UI state lives in `localStorage` under `vault-reader-*:v1` keys (reading positions, sidebar and inspector widths, sort key and direction, recent vaults capped at 12) plus `vault-reader-theme`. Reading positions are keyed `absolute:<lowercased path>` for disk files and `vault:<root>::<path>` otherwise. Bump the `:v1` suffix when changing a stored shape.

## Conventions and gotchas

- The version string `0.1.0` is hardcoded in four places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `scripts/copy-light-exe.js`.
- `electron`, `electron-builder`, and `@tauri-apps/cli` are pinned to `latest`; the runtime deps (`marked`, `dompurify`, `lucide`) are pinned exactly and loaded as vendored global scripts, never imported as modules.
- Electron runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`; Tauri sets `csp: null`. All rendered Markdown passes through DOMPurify. Keep it that way.
- Build targets are Windows x64 only. Drive-letter enumeration and the `USERPROFILE` default are Windows-specific with POSIX fallbacks.
- `.gitattributes` enforces LF line endings on all text files.
- Icons are Lucide `<i data-lucide="...">` placeholders; call `refreshIcons()` after injecting new ones into the DOM.
