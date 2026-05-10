const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const SKIPPED_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);

let mainWindow;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    sendOpenPaths(findMarkdownArgs(argv));
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: "Vault Reader",
    icon: path.join(__dirname, "app-icon.ico"),
    backgroundColor: "#f4f5f2",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    sendOpenPaths(findMarkdownArgs(process.argv));
  });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("vault:open-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Markdown folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  const rootPath = result.filePaths[0];
  const files = [];
  const folders = new Set();

  await walkDirectory(rootPath, rootPath, files, folders);

  files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));

  return {
    vaultName: path.basename(rootPath),
    rootPath,
    folders: Array.from(folders).sort(),
    files,
  };
});

ipcMain.handle("vault:open-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Markdown files",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile", "multiSelections"],
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return selectedFilesResult(result.filePaths);
});

ipcMain.handle("vault:open-paths", async (_event, filePaths) => {
  return associatedPathsResult(filePaths);
});

ipcMain.handle("vault:read-file", async (_event, absolutePath) => {
  return fs.readFile(absolutePath, "utf8");
});

ipcMain.handle("vault:write-file", async (_event, absolutePath, text) => {
  await fs.writeFile(absolutePath, text, "utf8");
  return true;
});

ipcMain.handle("vault:create-note", async (_event, options = {}) => {
  const requestedName = normalizeNoteName(options.name);
  const text = typeof options.text === "string" ? options.text : "";
  let targetPath;

  if (options.rootPath) {
    targetPath = await uniquePath(path.join(options.rootPath, requestedName));
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Create note",
      defaultPath: requestedName,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown"] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    targetPath = result.filePath;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text, "utf8");
  return fileEntry(targetPath, options.rootPath || path.dirname(targetPath));
});

ipcMain.handle("vault:open-external", async (_event, url) => {
  await shell.openExternal(url);
});

async function sendOpenPaths(filePaths) {
  if (!filePaths.length || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    const result = await associatedPathsResult(filePaths);
    if (result?.files?.length) {
      mainWindow.webContents.send("vault:opened-files", result);
    }
  } catch (error) {
    console.error(error);
  }
}

async function associatedPathsResult(filePaths) {
  const targetPaths = await collectMarkdownPaths(filePaths);
  if (!targetPaths.length) {
    return emptyOpenResult();
  }

  const parentPaths = new Set(targetPaths.map((filePath) => path.dirname(filePath).toLowerCase()));
  if (parentPaths.size === 1) {
    const rootPath = path.dirname(targetPaths[0]);
    const files = [];
    const folders = new Set();

    await walkDirectory(rootPath, rootPath, files, folders);
    files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));

    return {
      vaultName: path.basename(rootPath) || "Vault",
      rootPath,
      selectedId: findSelectedId(files, targetPaths[0]),
      folders: Array.from(folders).sort(),
      files,
    };
  }

  return selectedFilesResult(targetPaths);
}

async function selectedFilesResult(filePaths) {
  const targetPaths = await collectMarkdownPaths(filePaths);
  const files = [];

  for (const absolutePath of targetPaths) {
    files.push(await fileEntry(absolutePath, path.dirname(absolutePath)));
  }

  files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));

  if (!files.length) {
    return emptyOpenResult();
  }

  return {
    vaultName: files.length === 1 ? stripExtension(files[0].name) : "Loose files",
    rootPath: null,
    selectedId: findSelectedId(files, targetPaths[0]),
    folders: [],
    files,
  };
}

async function collectMarkdownPaths(filePaths) {
  const targetPaths = [];
  const seen = new Set();

  for (const filePath of filePaths || []) {
    const absolutePath = path.resolve(filePath);
    const key = absolutePath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    try {
      const stats = await fs.stat(absolutePath);
      if (stats.isFile() && isMarkdownFile(absolutePath)) {
        targetPaths.push(absolutePath);
        seen.add(key);
      }
    } catch {
      // Ignore stale or non-file arguments passed by the shell.
    }
  }

  return targetPaths;
}

function emptyOpenResult() {
  return {
    vaultName: "Loose files",
    rootPath: null,
    folders: [],
    files: [],
  };
}

function findSelectedId(files, selectedPath) {
  const selectedKey = path.resolve(selectedPath).toLowerCase();
  return files.find((file) => path.resolve(file.absolutePath).toLowerCase() === selectedKey)?.id || files[0]?.id || null;
}

async function walkDirectory(currentPath, rootPath, files, folders) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) {
        continue;
      }

      folders.add(toVaultPath(path.relative(rootPath, absolutePath)));
      await walkDirectory(absolutePath, rootPath, files, folders);
      continue;
    }

    if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(await fileEntry(absolutePath, rootPath));
    }
  }
}

async function fileEntry(absolutePath, rootPath) {
  const stats = await fs.stat(absolutePath);
  const relativePath = toVaultPath(path.relative(rootPath, absolutePath)) || path.basename(absolutePath);
  const name = path.basename(absolutePath);

  return {
    id: `disk:${absolutePath}`,
    absolutePath,
    path: relativePath,
    name,
    title: stripExtension(name),
    directory: parentPath(relativePath),
    text: null,
    size: stats.size,
    created: stats.birthtimeMs,
    modified: stats.mtimeMs,
    isDisk: true,
  };
}

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeNoteName(name) {
  const cleaned = String(name || "Untitled")
    .trim()
    .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ");
  const base = cleaned || "Untitled";
  return isMarkdownFile(base) ? base : `${base}.md`;
}

async function uniquePath(initialPath) {
  const extension = path.extname(initialPath) || ".md";
  const basePath = initialPath.slice(0, initialPath.length - extension.length);
  let candidate = initialPath;
  let counter = 2;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = `${basePath} ${counter}${extension}`;
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

function findMarkdownArgs(argv) {
  return (argv || [])
    .filter((arg) => arg && !arg.startsWith("--"))
    .map((arg) => arg.replace(/^"|"$/g, ""))
    .filter((arg) => isMarkdownFile(arg));
}

function stripExtension(name) {
  return name.replace(/\.(md|markdown|mdown)$/i, "");
}

function parentPath(filePath) {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "" : filePath.slice(0, index);
}

function toVaultPath(value) {
  return value.split(path.sep).join("/");
}
