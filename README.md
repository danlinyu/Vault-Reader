# Vault Reader

Vault Reader is a small, local-first Markdown note reader and editor for Windows. It borrows the practical parts of an Obsidian-style workspace without trying to be a full Obsidian replacement.

## Features

- Open a folder as a Markdown vault.
- Open individual `.md`, `.markdown`, and `.mdown` files.
- Edit notes directly in Live mode, or use Source and Split mode when you want raw Markdown.
- Use line numbers in Source and Split mode while editing Markdown.
- Save with the toolbar button or `Ctrl+S`.
- Create notes with the toolbar button or `Ctrl+N`.
- Preview Markdown with outline, word count, reading time, links, and linked mentions.
- Navigate wiki links such as `[[Research Log]]`.
- Use quick switcher with `Ctrl+P`.
- Toggle light/dark theme.
- Open `.md` files from Windows "Open with" by selecting the executable.

## Downloads

The recommended Windows build is the lightweight executable:

- `Vault-Reader-light-0.1.0.exe`

It uses Windows WebView2, so it stays small. A larger Electron portable build is also available:

- `Vault-Reader-0.1.0-portable.exe`

## Development

Install dependencies:

```powershell
npm install
```

Run the Electron development shell:

```powershell
npm run start
```

Build the lightweight Windows executable:

```powershell
npm run build:light
```

Build the bundled Electron portable executable:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run build:portable
```

## Project Layout

- `index.html`, `styles.css`, `app.js`: shared app UI.
- `main.js`, `preload.js`: Electron shell.
- `src-tauri/`: lightweight Tauri shell.
- `scripts/`: build helpers.

## Notes

Vault Reader keeps notes as normal Markdown files on disk. There is no private database.
