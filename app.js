const SAMPLE_NOTE = `# Field Notes

A compact reading surface for plain-text notes, drafts, and project logs.

## Today

- Review the migration checklist
- Cross-link the project brief with [[Research Log]]
- Keep decisions close to the evidence

## Extract

> The useful note is the one that can be found again, read quickly, and trusted later.

\`\`\`js
const reader = "local-first";
console.log(reader);
\`\`\`
`;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const SKIPPED_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);
const POSITION_STORAGE_KEY = "vault-reader-reading-positions:v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "vault-reader-sidebar-width:v1";
const INSPECTOR_WIDTH_STORAGE_KEY = "vault-reader-inspector-width:v1";
const SORT_KEY_STORAGE_KEY = "vault-reader-sort-key:v1";
const SORT_DIRECTION_STORAGE_KEY = "vault-reader-sort-direction:v1";
const RECENT_VAULTS_STORAGE_KEY = "vault-reader-recent-vaults:v1";
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 560;
const INSPECTOR_MIN_WIDTH = 230;
const INSPECTOR_MAX_WIDTH = 520;
const RECENT_VAULT_LIMIT = 12;

const state = {
  files: [],
  currentId: null,
  tabs: [],
  rootPath: null,
  directoryHandle: null,
  folders: new Set(),
  readingPositions: loadStoredReadingPositions(),
  treeOpen: new Set(),
  search: "",
  quickSearch: "",
  sortKey: normalizeSortKey(localStorage.getItem(SORT_KEY_STORAGE_KEY)),
  sortDirection: normalizeSortDirection(localStorage.getItem(SORT_DIRECTION_STORAGE_KEY)),
  sidebarWidth: loadStoredSidebarWidth(),
  inspectorWidth: loadStoredInspectorWidth(),
  recentVaults: loadStoredRecentVaults(),
  view: "live",
  theme: localStorage.getItem("vault-reader-theme") || "light",
  vaultName: "Reader",
  indexed: false,
  renderTimer: null,
  liveTimer: null,
  liveLineTimer: null,
  positionTimer: null,
  restoringPosition: false,
};

const elements = {
  appShell: document.querySelector("#appShell"),
  sidebar: document.querySelector("#sidebar"),
  sidebarResizer: document.querySelector("#sidebarResizer"),
  inspector: document.querySelector("#inspector"),
  inspectorResizer: document.querySelector("#inspectorResizer"),
  openFolderButton: document.querySelector("#openFolderButton"),
  openFilesButton: document.querySelector("#openFilesButton"),
  newNoteButton: document.querySelector("#newNoteButton"),
  quickOpenButton: document.querySelector("#quickOpenButton"),
  showSidebarButton: document.querySelector("#showSidebarButton"),
  toggleThemeButton: document.querySelector("#toggleThemeButton"),
  collapseSidebarButton: document.querySelector("#collapseSidebarButton"),
  vaultSelect: document.querySelector("#vaultSelect"),
  openOtherVaultButton: document.querySelector("#openOtherVaultButton"),
  fileSearch: document.querySelector("#fileSearch"),
  fileSortSelect: document.querySelector("#fileSortSelect"),
  sortDirectionButton: document.querySelector("#sortDirectionButton"),
  fileTree: document.querySelector("#fileTree"),
  fileCount: document.querySelector("#fileCount"),
  indexStatus: document.querySelector("#indexStatus"),
  folderInput: document.querySelector("#folderInput"),
  fileInput: document.querySelector("#fileInput"),
  vaultName: document.querySelector("#vaultName"),
  noteTitle: document.querySelector("#noteTitle"),
  notePath: document.querySelector("#notePath"),
  tabStrip: document.querySelector("#tabStrip"),
  saveButton: document.querySelector("#saveButton"),
  saveState: document.querySelector("#saveState"),
  sourceText: document.querySelector("#sourceText"),
  sourceLineNumbers: document.querySelector("#sourceLineNumbers"),
  liveLineNumbers: document.querySelector("#liveLineNumbers"),
  previewPane: document.querySelector("#previewPane"),
  markdownView: document.querySelector("#markdownView"),
  outline: document.querySelector("#outline"),
  wordCount: document.querySelector("#wordCount"),
  lineCount: document.querySelector("#lineCount"),
  readingTime: document.querySelector("#readingTime"),
  linkCount: document.querySelector("#linkCount"),
  backlinks: document.querySelector("#backlinks"),
  quickOpen: document.querySelector("#quickOpen"),
  quickSearch: document.querySelector("#quickSearch"),
  quickResults: document.querySelector("#quickResults"),
  noteDialog: document.querySelector("#noteDialog"),
  noteForm: document.querySelector("#noteForm"),
  noteNameInput: document.querySelector("#noteNameInput"),
  noteCancelButton: document.querySelector("#noteCancelButton"),
  noteDialogError: document.querySelector("#noteDialogError"),
  viewButtons: Array.from(document.querySelectorAll("[data-view-mode]")),
};

document.documentElement.dataset.theme = state.theme;
elements.appShell.dataset.view = state.view;

function boot() {
  applySidebarWidth(state.sidebarWidth, { persist: false });
  applyInspectorWidth(state.inspectorWidth, { persist: false });
  elements.showSidebarButton.hidden = true;
  updateSortControls();
  renderVaultSwitcher();
  wireEvents();
  wireNativeOpenEvents();
  syncThemeButton();
  loadSample();
  refreshIcons();
}

function wireEvents() {
  elements.openFolderButton.addEventListener("click", openFolder);
  elements.openFilesButton.addEventListener("click", openFiles);
  elements.newNoteButton.addEventListener("click", showNoteDialog);
  elements.quickOpenButton.addEventListener("click", showQuickOpen);
  elements.showSidebarButton.addEventListener("click", () => setSidebarCollapsed(false));
  elements.toggleThemeButton.addEventListener("click", toggleTheme);
  elements.collapseSidebarButton.addEventListener("click", toggleSidebar);
  elements.openOtherVaultButton.addEventListener("click", openFolder);
  elements.vaultSelect.addEventListener("change", handleVaultSelectChange);
  elements.saveButton.addEventListener("click", saveCurrentNote);
  elements.sourceText.addEventListener("input", handleSourceInput);
  elements.sourceText.addEventListener("scroll", () => {
    syncLineNumberScroll();
    scheduleReadingPositionSave();
  });
  elements.previewPane.addEventListener("scroll", scheduleReadingPositionSave);
  elements.markdownView.addEventListener("input", handleLiveInput);
  elements.markdownView.addEventListener("keydown", handleLiveKeydown);
  elements.markdownView.addEventListener("paste", handleLivePaste);
  window.addEventListener("resize", handleWindowResize);
  elements.noteForm.addEventListener("submit", handleNoteCreate);
  elements.noteCancelButton.addEventListener("click", hideNoteDialog);

  elements.folderInput.addEventListener("change", handleFolderInput);
  elements.fileInput.addEventListener("change", handleFileInput);

  elements.fileSearch.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderFileTree();
  });

  elements.fileSortSelect.addEventListener("change", (event) => {
    state.sortKey = normalizeSortKey(event.target.value);
    state.sortDirection = defaultSortDirection(state.sortKey);
    persistSortState();
    updateSortControls();
    renderFileTree();
    renderQuickResults();
    refreshIcons();
  });

  elements.sortDirectionButton.addEventListener("click", toggleSortDirection);
  elements.sidebarResizer.addEventListener("pointerdown", beginSidebarResize);
  elements.sidebarResizer.addEventListener("keydown", handleSidebarResizeKeydown);
  elements.inspectorResizer.addEventListener("pointerdown", beginInspectorResize);
  elements.inspectorResizer.addEventListener("keydown", handleInspectorResizeKeydown);

  elements.quickSearch.addEventListener("input", (event) => {
    state.quickSearch = event.target.value.trim().toLowerCase();
    renderQuickResults();
  });

  elements.quickOpen.addEventListener("click", (event) => {
    if (event.target === elements.quickOpen) {
      hideQuickOpen();
    }
  });

  elements.noteDialog.addEventListener("click", (event) => {
    if (event.target === elements.noteDialog) {
      hideNoteDialog();
    }
  });

  elements.markdownView.addEventListener("click", handlePreviewClick);

  elements.viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewMode));
  });

  window.addEventListener("beforeunload", saveCurrentReadingPosition);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveCurrentNote();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      showNoteDialog();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      showQuickOpen();
      return;
    }

    if (event.key === "Escape" && !elements.quickOpen.hidden) {
      hideQuickOpen();
    }

    if (event.key === "Escape" && !elements.noteDialog.hidden) {
      hideNoteDialog();
    }

    if (event.key === "Enter" && !elements.quickOpen.hidden) {
      const firstResult = elements.quickResults.querySelector(".quick-result");
      if (firstResult) {
        selectFile(firstResult.dataset.fileId);
        hideQuickOpen();
      }
    }
  });
}

function wireNativeOpenEvents() {
  if (window.vaultReaderNative?.onOpenedFiles) {
    window.vaultReaderNative.onOpenedFiles((result) => loadNativeResult(result));
  }

  window.addEventListener("vault-reader-open-paths", (event) => {
    loadTauriPaths(event.detail);
  });

  if (Array.isArray(window.__VAULT_READER_TAURI_OPEN_PATHS)) {
    loadTauriPaths(window.__VAULT_READER_TAURI_OPEN_PATHS);
    window.__VAULT_READER_TAURI_OPEN_PATHS = null;
  }
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function normalizeSortKey(value) {
  return ["name", "modified", "created", "size"].includes(value) ? value : "name";
}

function normalizeSortDirection(value) {
  return value === "desc" ? "desc" : "asc";
}

function defaultSortDirection(sortKey) {
  return ["modified", "created", "size"].includes(sortKey) ? "desc" : "asc";
}

function persistSortState() {
  localStorage.setItem(SORT_KEY_STORAGE_KEY, state.sortKey);
  localStorage.setItem(SORT_DIRECTION_STORAGE_KEY, state.sortDirection);
}

function updateSortControls() {
  elements.fileSortSelect.value = state.sortKey;
  const ascending = state.sortDirection === "asc";
  const title = sortDirectionLabel();
  elements.sortDirectionButton.title = title;
  elements.sortDirectionButton.setAttribute("aria-label", title);
  elements.sortDirectionButton.innerHTML = `<i data-lucide="${ascending ? "arrow-up" : "arrow-down"}"></i>`;
}

function sortDirectionLabel() {
  if (state.sortKey === "modified" || state.sortKey === "created") {
    return state.sortDirection === "desc" ? "Newest first" : "Oldest first";
  }

  if (state.sortKey === "size") {
    return state.sortDirection === "desc" ? "Largest first" : "Smallest first";
  }

  return state.sortDirection === "desc" ? "Z to A" : "A to Z";
}

function toggleSortDirection() {
  state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  persistSortState();
  updateSortControls();
  renderFileTree();
  renderQuickResults();
  refreshIcons();
}

function handleWindowResize() {
  handleLiveLineNumberResize();
  updateSidebarResizeAria();
  updateInspectorResizeAria();
}

function loadStoredRecentVaults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_VAULTS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((vault) => vault && typeof vault.rootPath === "string" && typeof vault.name === "string")
      .slice(0, RECENT_VAULT_LIMIT);
  } catch {
    return [];
  }
}

function rememberVault(rootPath, name) {
  if (!rootPath) {
    return;
  }

  const key = rootPath.toLowerCase();
  const nextVault = { rootPath, name: name || rootPath.split(/[\\/]/).filter(Boolean).pop() || "Vault" };
  state.recentVaults = [
    nextVault,
    ...state.recentVaults.filter((vault) => vault.rootPath.toLowerCase() !== key),
  ].slice(0, RECENT_VAULT_LIMIT);
  persistRecentVaults();
}

function persistRecentVaults() {
  localStorage.setItem(RECENT_VAULTS_STORAGE_KEY, JSON.stringify(state.recentVaults));
}

function renderVaultSwitcher() {
  elements.vaultSelect.textContent = "";

  const currentValue = state.rootPath || "__current__";
  const currentOption = document.createElement("option");
  currentOption.value = currentValue;
  currentOption.textContent = state.rootPath ? state.vaultName : `${state.vaultName} (current)`;
  elements.vaultSelect.append(currentOption);

  for (const vault of state.recentVaults) {
    if (vault.rootPath === state.rootPath) {
      continue;
    }

    const option = document.createElement("option");
    option.value = vault.rootPath;
    option.textContent = vault.name;
    option.title = vault.rootPath;
    elements.vaultSelect.append(option);
  }

  elements.vaultSelect.value = currentValue;
  elements.vaultSelect.title = state.rootPath || "Open a vault folder to start switching between recent vaults.";
}

async function handleVaultSelectChange(event) {
  const rootPath = event.target.value;
  if (!rootPath || rootPath === "__current__" || rootPath === state.rootPath) {
    renderVaultSwitcher();
    return;
  }

  await openVaultPath(rootPath);
}

async function openVaultPath(rootPath) {
  try {
    let result = null;

    if (window.vaultReaderNative?.openVaultPath) {
      result = await window.vaultReaderNative.openVaultPath(rootPath);
    } else {
      const invoke = getTauriInvoke();
      if (invoke) {
        result = await invoke("open_vault_path", { rootPath });
      }
    }

    if (result?.files?.length) {
      await loadNativeResult(result);
      return;
    }

    setIndexStatus("Open failed");
  } catch (error) {
    console.warn(error);
    setIndexStatus("Open failed");
  } finally {
    renderVaultSwitcher();
  }
}

function loadStoredSidebarWidth() {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return clampSidebarWidth(Number.isFinite(stored) ? stored : 288);
}

function applySidebarWidth(width, options = {}) {
  const nextWidth = clampSidebarWidth(width);
  state.sidebarWidth = nextWidth;
  elements.appShell.style.setProperty("--sidebar-width", `${nextWidth}px`);

  if (options.persist !== false) {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  }

  updateSidebarResizeAria();
}

function beginSidebarResize(event) {
  if (elements.appShell.classList.contains("sidebar-collapsed") || window.matchMedia("(max-width: 820px)").matches) {
    return;
  }

  event.preventDefault();
  elements.appShell.classList.add("is-resizing-sidebar");
  elements.sidebarResizer.setPointerCapture?.(event.pointerId);

  const handlePointerMove = (moveEvent) => {
    const sidebarLeft = elements.sidebar.getBoundingClientRect().left;
    applySidebarWidth(moveEvent.clientX - sidebarLeft);
  };

  const handlePointerUp = () => {
    elements.appShell.classList.remove("is-resizing-sidebar");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
  handlePointerMove(event);
}

function handleSidebarResizeKeydown(event) {
  const step = event.shiftKey ? 40 : 16;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    applySidebarWidth(state.sidebarWidth - step);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    applySidebarWidth(state.sidebarWidth + step);
  } else if (event.key === "Home") {
    event.preventDefault();
    applySidebarWidth(SIDEBAR_MIN_WIDTH);
  } else if (event.key === "End") {
    event.preventDefault();
    applySidebarWidth(SIDEBAR_MAX_WIDTH);
  }
}

function updateSidebarResizeAria() {
  elements.sidebarResizer.setAttribute("aria-valuemin", String(SIDEBAR_MIN_WIDTH));
  elements.sidebarResizer.setAttribute("aria-valuemax", String(SIDEBAR_MAX_WIDTH));
  elements.sidebarResizer.setAttribute("aria-valuenow", String(state.sidebarWidth));
}

function clampSidebarWidth(width) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function loadStoredInspectorWidth() {
  const stored = Number(localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
  return clampInspectorWidth(Number.isFinite(stored) ? stored : 286);
}

function applyInspectorWidth(width, options = {}) {
  const nextWidth = clampInspectorWidth(width);
  state.inspectorWidth = nextWidth;
  elements.appShell.style.setProperty("--inspector-width", `${nextWidth}px`);

  if (options.persist !== false) {
    localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(nextWidth));
  }

  updateInspectorResizeAria();
}

function beginInspectorResize(event) {
  if (window.matchMedia("(max-width: 1180px)").matches) {
    return;
  }

  event.preventDefault();
  elements.appShell.classList.add("is-resizing-inspector");
  elements.inspectorResizer.setPointerCapture?.(event.pointerId);

  const handlePointerMove = (moveEvent) => {
    const inspectorRight = elements.inspector.getBoundingClientRect().right;
    applyInspectorWidth(inspectorRight - moveEvent.clientX);
  };

  const handlePointerUp = () => {
    elements.appShell.classList.remove("is-resizing-inspector");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
  handlePointerMove(event);
}

function handleInspectorResizeKeydown(event) {
  const step = event.shiftKey ? 40 : 16;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    applyInspectorWidth(state.inspectorWidth + step);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    applyInspectorWidth(state.inspectorWidth - step);
  } else if (event.key === "Home") {
    event.preventDefault();
    applyInspectorWidth(INSPECTOR_MIN_WIDTH);
  } else if (event.key === "End") {
    event.preventDefault();
    applyInspectorWidth(INSPECTOR_MAX_WIDTH);
  }
}

function updateInspectorResizeAria() {
  elements.inspectorResizer.setAttribute("aria-valuemin", String(INSPECTOR_MIN_WIDTH));
  elements.inspectorResizer.setAttribute("aria-valuemax", String(INSPECTOR_MAX_WIDTH));
  elements.inspectorResizer.setAttribute("aria-valuenow", String(state.inspectorWidth));
}

function clampInspectorWidth(width) {
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(width)));
}

function loadSample() {
  const sample = {
    id: "sample:field-notes",
    path: "Field Notes.md",
    name: "Field Notes.md",
    title: "Field Notes",
    directory: "",
    text: SAMPLE_NOTE,
    size: SAMPLE_NOTE.length,
    created: null,
    modified: null,
    isSample: true,
  };

  state.files = [sample];
  state.currentId = null;
  state.tabs = [];
  state.rootPath = null;
  state.directoryHandle = null;
  state.vaultName = "Reader";
  state.indexed = true;
  renderAll();
  selectFile(sample.id);
}

async function openFolder() {
  if (window.vaultReaderNative) {
    try {
      const result = await window.vaultReaderNative.openFolder();
      if (result) {
        await loadNativeResult(result);
      }
    } catch (error) {
      console.warn(error);
      setIndexStatus("Open failed");
    }
    return;
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const result = await invoke("open_folder");
      if (result) {
        await loadNativeResult(result);
      }
    } catch (error) {
      console.warn(error);
      setIndexStatus("Open failed");
    }
    return;
  }

  if ("showDirectoryPicker" in window) {
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
      await loadDirectoryHandle(directoryHandle);
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn(error);
        elements.folderInput.click();
      }
      return;
    }
  }

  elements.folderInput.click();
}

async function openFiles() {
  if (window.vaultReaderNative) {
    try {
      const result = await window.vaultReaderNative.openFiles();
      if (result) {
        await loadNativeResult(result);
      }
    } catch (error) {
      console.warn(error);
      setIndexStatus("Open failed");
    }
    return;
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      const result = await invoke("open_files");
      if (result) {
        await loadNativeResult(result);
      }
    } catch (error) {
      console.warn(error);
      setIndexStatus("Open failed");
    }
    return;
  }

  elements.fileInput.click();
}

async function loadNativeResult(result) {
  if (!result.files?.length) {
    setIndexStatus("No notes");
    return;
  }

  state.directoryHandle = null;
  replaceFiles(result.files, result.vaultName, new Set(result.folders || []), result.rootPath || null);
  if (!result.rootPath && result.files.length > 1) {
    state.tabs = result.files.map((file) => file.id);
  }
  const selectedId = result.files.some((file) => file.id === result.selectedId) ? result.selectedId : result.files[0].id;
  await selectFile(selectedId);
  indexFilesInBackground();
}

async function loadTauriPaths(paths) {
  const invoke = getTauriInvoke();
  if (!invoke || !Array.isArray(paths) || !paths.length) {
    return;
  }

  try {
    const result = await invoke("load_paths", { paths });
    await loadNativeResult(result);
  } catch (error) {
    console.warn(error);
    setIndexStatus("Open failed");
  }
}

async function loadDirectoryHandle(directoryHandle) {
  setIndexStatus("Scanning");
  const files = [];
  const folders = new Set();
  state.directoryHandle = directoryHandle;

  await walkDirectory(directoryHandle, "", files, folders);

  if (!files.length) {
    setIndexStatus("No notes");
    return;
  }

  replaceFiles(files, directoryHandle.name, folders, null);
  await selectFile(files[0].id);
  indexFilesInBackground();
}

async function walkDirectory(directoryHandle, prefix, files, folders) {
  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    entries.push([name, handle]);
  }

  entries.sort(([leftName, leftHandle], [rightName, rightHandle]) => {
    if (leftHandle.kind !== rightHandle.kind) {
      return leftHandle.kind === "directory" ? -1 : 1;
    }
    return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
  });

  for (const [name, handle] of entries) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      if (!SKIPPED_DIRS.has(name)) {
        folders.add(path);
        await walkDirectory(handle, path, files, folders);
      }
      continue;
    }

    if (isMarkdownFile(name)) {
      files.push({
        id: `handle:${path}`,
        path,
        name,
        title: stripExtension(name),
        directory: parentPath(path),
        handle,
        text: null,
        size: null,
        created: null,
        modified: null,
        isSample: false,
      });
    }
  }
}

async function handleFolderInput(event) {
  const picked = Array.from(event.target.files || []).filter((file) => isMarkdownFile(file.name));
  event.target.value = "";

  if (!picked.length) {
    return;
  }

  const rootName = picked[0].webkitRelativePath?.split("/")[0] || "Folder";
  const folders = new Set();
  const files = picked.map((file, index) => {
    const path = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
    collectParentFolders(path, folders);
    return fileToEntry(file, path || file.name, `folder:${index}:`);
  });

  state.directoryHandle = null;
  replaceFiles(files, rootName, folders, null);
  await selectFile(files[0].id);
  indexFilesInBackground();
}

async function handleFileInput(event) {
  const picked = Array.from(event.target.files || []).filter((file) => isMarkdownFile(file.name));
  event.target.value = "";

  if (!picked.length) {
    return;
  }

  const files = picked.map((file, index) => fileToEntry(file, file.name, `file:${index}:`));
  state.directoryHandle = null;
  replaceFiles(files, picked.length === 1 ? stripExtension(picked[0].name) : "Loose files", new Set(), null);
  if (files.length > 1) {
    state.tabs = files.map((file) => file.id);
  }
  await selectFile(files[0].id);
  indexFilesInBackground();
}

function fileToEntry(file, path, idPrefix) {
  return {
    id: `${idPrefix}${path}`,
    path,
    name: file.name,
    title: stripExtension(file.name),
    directory: parentPath(path),
    file,
    text: null,
    size: file.size,
    created: null,
    modified: file.lastModified || null,
    isSample: false,
  };
}

function replaceFiles(files, vaultName, folders, rootPath = null) {
  saveCurrentReadingPosition();
  files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));
  state.files = files;
  state.currentId = null;
  state.tabs = [];
  state.rootPath = rootPath;
  state.folders = folders;
  state.treeOpen = new Set();
  state.vaultName = vaultName || "Vault";
  state.search = "";
  state.quickSearch = "";
  state.indexed = false;
  rememberVault(rootPath, state.vaultName);
  elements.fileSearch.value = "";
  setIndexStatus("Ready");
  renderAll();
}

async function indexFilesInBackground() {
  const candidates = state.files.filter((file) => !file.text);
  if (!candidates.length) {
    state.indexed = true;
    setIndexStatus("Indexed");
    updateBacklinks();
    return;
  }

  setIndexStatus("Indexing");
  let completed = 0;

  for (const file of candidates) {
    try {
      await readEntryText(file);
    } catch (error) {
      console.warn(`Could not index ${file.path}`, error);
    }

    completed += 1;
    if (completed % 15 === 0) {
      setIndexStatus(`${completed}/${candidates.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  state.indexed = true;
  setIndexStatus("Indexed");
  updateBacklinks();
}

async function selectFile(fileId) {
  const file = state.files.find((entry) => entry.id === fileId);
  if (!file) {
    return;
  }

  if (state.currentId !== file.id) {
    saveCurrentReadingPosition();
  }

  state.currentId = file.id;
  openTab(file.id);
  const text = await readEntryText(file);
  elements.noteTitle.textContent = file.title;
  elements.notePath.textContent = file.path;
  elements.sourceText.value = text;
  elements.sourceText.readOnly = false;
  elements.markdownView.contentEditable = state.view === "source" ? "false" : "true";
  updateLineNumbers();
  renderCurrentMarkdown(text);
  updateBacklinks();
  updateSaveState();
  renderFileTree();
  renderTabs();
  restoreReadingPosition(file);
  document.title = `${file.title} - Vault Reader`;
}

function handleSourceInput() {
  const file = getCurrentFile();
  if (!file) {
    return;
  }

  const markdown = elements.sourceText.value;
  file.text = markdown;
  file.dirty = true;
  updateLineNumbers();
  updateSaveState();
  renderFileTree();
  renderTabs();

  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => {
    renderCurrentMarkdown(file.text);
    updateBacklinks();
  }, 120);
}

function handleLiveInput() {
  const file = getCurrentFile();
  if (!file) {
    return;
  }

  const markdown = markdownFromEditor(elements.markdownView);
  file.text = markdown;
  file.dirty = true;
  elements.sourceText.value = markdown;
  updateLineNumbers();
  updateSaveState();
  renderFileTree();
  renderTabs();

  clearTimeout(state.liveTimer);
  state.liveTimer = setTimeout(() => {
    decorateHeadings();
    renderOutline(extractHeadings(markdown));
    updateDetails(markdown);
    updateLiveLineNumbers(markdown);
    updateBacklinks();
  }, 120);
}

function handleLiveLineNumberResize() {
  const file = getCurrentFile();
  if (!file) {
    return;
  }

  clearTimeout(state.liveLineTimer);
  state.liveLineTimer = setTimeout(() => {
    updateLiveLineNumbers(file.text || elements.sourceText.value);
  }, 100);
}

function handleLiveKeydown(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "b" || key === "i") {
    event.preventDefault();
    document.execCommand(key === "b" ? "bold" : "italic");
    handleLiveInput();
  }
}

function handleLivePaste(event) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) {
    return;
  }

  event.preventDefault();
  document.execCommand("insertText", false, text);
  handleLiveInput();
}

function renderCurrentMarkdown(text) {
  elements.markdownView.innerHTML = renderMarkdown(text);
  decorateRenderedNote(text);
  updateDetails(text);
  updateLiveLineNumbers(text);
}

async function readEntryText(file) {
  if (typeof file.text === "string") {
    return file.text;
  }

  let rawFile;
  if (file.handle) {
    rawFile = await file.handle.getFile();
  } else if (file.file) {
    rawFile = file.file;
  } else if (file.absolutePath && window.vaultReaderNative) {
    file.text = await window.vaultReaderNative.readFile(file.absolutePath);
    return file.text;
  } else if (file.absolutePath && getTauriInvoke()) {
    file.text = await getTauriInvoke()("read_file", { absolutePath: file.absolutePath });
    return file.text;
  } else {
    file.text = "";
    return file.text;
  }

  file.text = await rawFile.text();
  file.size = rawFile.size;
  file.created = file.created || null;
  file.modified = rawFile.lastModified || null;
  return file.text;
}

async function saveCurrentNote() {
  const file = getCurrentFile();
  if (!file) {
    return;
  }

  const text = getCurrentMarkdownText();
  setSaveState("Saving", "saving");

  try {
    if (file.absolutePath) {
      await writeDiskFile(file.absolutePath, text);
      file.text = text;
      file.dirty = false;
      file.size = text.length;
      file.modified = Date.now();
      setSaveState("Saved", "saved");
      renderFileTree();
      renderTabs();
      return;
    }

    if (file.handle?.createWritable) {
      const writable = await file.handle.createWritable();
      await writable.write(text);
      await writable.close();
      file.text = text;
      file.dirty = false;
      file.size = text.length;
      file.modified = Date.now();
      setSaveState("Saved", "saved");
      renderFileTree();
      renderTabs();
      return;
    }

    const created = await createPersistedNote(file.title, text);
    if (!created) {
      throw new Error("Save canceled.");
    }
    replaceOrAddFile(file, created);
    await selectFile(created.id);
    setSaveState("Saved", "saved");
  } catch (error) {
    console.warn(error);
    setSaveState("Save failed", "dirty");
  }
}

async function writeDiskFile(absolutePath, text) {
  if (window.vaultReaderNative?.writeFile) {
    await window.vaultReaderNative.writeFile(absolutePath, text);
    return;
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    await invoke("write_file", { absolutePath, text });
    return;
  }

  throw new Error("No disk writer is available.");
}

async function createPersistedNote(name, text) {
  if (window.vaultReaderNative?.createNote) {
    return window.vaultReaderNative.createNote({
      rootPath: state.rootPath,
      name,
      text,
    });
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    return invoke("create_note", {
      rootPath: state.rootPath,
      name,
      text,
    });
  }

  if (state.directoryHandle?.getFileHandle) {
    const fileName = normalizeNoteFileName(name);
    const handle = await state.directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return {
      id: `handle:${fileName}`,
      path: fileName,
      name: fileName,
      title: stripExtension(fileName),
      directory: "",
      handle,
      text,
      size: text.length,
      created: Date.now(),
      modified: Date.now(),
      isSample: false,
    };
  }

  return createDraftNoteEntry(name, text);
}

function showNoteDialog() {
  elements.noteDialog.hidden = false;
  elements.noteDialogError.hidden = true;
  elements.noteDialogError.textContent = "";
  elements.noteNameInput.value = nextUntitledName();
  requestAnimationFrame(() => {
    elements.noteNameInput.focus();
    elements.noteNameInput.select();
  });
}

function hideNoteDialog() {
  elements.noteDialog.hidden = true;
}

async function handleNoteCreate(event) {
  event.preventDefault();

  const requestedName = elements.noteNameInput.value.trim() || "Untitled";
  const fileName = normalizeNoteFileName(requestedName);
  const title = stripExtension(fileName);
  const text = `# ${title}\n\n`;

  try {
    const created = await createPersistedNote(fileName, text);
    if (!created) {
      return;
    }
    created.text = typeof created.text === "string" ? created.text : text;
    created.dirty = !created.absolutePath && !created.handle;
    addFileEntry(created);
    hideNoteDialog();
    await selectFile(created.id);
    setView("live");
    focusLiveEditorEnd();
  } catch (error) {
    console.warn(error);
    elements.noteDialogError.textContent = "Could not create the note.";
    elements.noteDialogError.hidden = false;
  }
}

function focusLiveEditorEnd() {
  elements.markdownView.focus();
  const range = document.createRange();
  range.selectNodeContents(elements.markdownView);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function addFileEntry(file) {
  state.files = state.files.filter((entry) => entry.id !== file.id);
  state.files.push(file);
  collectParentFolders(file.path, state.folders);
  renderAll();
}

function replaceOrAddFile(previousFile, nextFile) {
  const previousKey = filePositionKey(previousFile);
  const previousPosition = state.readingPositions.get(previousKey);
  const index = state.files.findIndex((file) => file.id === previousFile.id);
  if (index === -1) {
    state.files.push(nextFile);
  } else {
    state.files[index] = {
      ...nextFile,
      text: nextFile.text ?? previousFile.text,
      dirty: false,
    };
  }
  state.tabs = uniqueIds(state.tabs.map((id) => (id === previousFile.id ? nextFile.id : id)));
  if (previousPosition) {
    state.readingPositions.set(filePositionKey(nextFile), previousPosition);
    persistReadingPositions();
  }
  collectParentFolders(nextFile.path, state.folders);
  renderAll();
}

function createDraftNoteEntry(name, text) {
  const fileName = normalizeNoteFileName(name);
  const id = `draft:${Date.now()}:${fileName}`;
  return {
    id,
    path: fileName,
    name: fileName,
    title: stripExtension(fileName),
    directory: "",
    text,
    size: text.length,
    created: Date.now(),
    modified: Date.now(),
    dirty: true,
    isDraft: true,
  };
}

function updateSaveState() {
  const file = getCurrentFile();
  if (!file) {
    setSaveState("No note", "readonly");
    return;
  }

  if (file.dirty) {
    setSaveState("Unsaved", "dirty");
    return;
  }

  setSaveState("Saved", "saved");
}

function setSaveState(label, mode) {
  elements.saveState.textContent = label;
  elements.saveButton.classList.toggle("is-dirty", mode === "dirty");
  elements.saveButton.classList.toggle("is-saving", mode === "saving");
  elements.saveButton.classList.toggle("is-readonly", mode === "readonly");
}

function getCurrentFile() {
  return state.files.find((entry) => entry.id === state.currentId) || null;
}

function openTab(fileId) {
  if (!state.tabs.includes(fileId)) {
    state.tabs.push(fileId);
  }
}

function closeTab(fileId) {
  if (state.tabs.length <= 1) {
    return;
  }

  const index = state.tabs.indexOf(fileId);
  if (index === -1) {
    return;
  }

  const closingCurrent = fileId === state.currentId;
  if (closingCurrent) {
    saveCurrentReadingPosition();
  }

  state.tabs.splice(index, 1);

  if (closingCurrent) {
    const nextId = state.tabs[Math.min(index, state.tabs.length - 1)];
    selectFile(nextId);
    return;
  }

  renderTabs();
}

function renderTabs() {
  state.tabs = state.tabs.filter((id) => state.files.some((file) => file.id === id));
  elements.tabStrip.textContent = "";
  elements.tabStrip.hidden = state.tabs.length === 0;

  for (const fileId of state.tabs) {
    const file = state.files.find((entry) => entry.id === fileId);
    if (!file) {
      continue;
    }

    const item = document.createElement("div");
    item.className = `note-tab-item${file.id === state.currentId ? " is-active" : ""}`;

    const button = document.createElement("button");
    button.className = `note-tab${file.dirty ? " is-dirty" : ""}`;
    button.type = "button";
    button.role = "tab";
    button.ariaSelected = file.id === state.currentId ? "true" : "false";
    button.title = fileTooltip(file);
    button.innerHTML = `<i data-lucide="file-text"></i><span></span>`;
    button.querySelector("span").textContent = file.title;
    button.addEventListener("click", () => selectFile(file.id));

    const close = document.createElement("button");
    close.className = "note-tab-close";
    close.type = "button";
    close.title = `Close ${file.title}`;
    close.ariaLabel = `Close ${file.title}`;
    close.disabled = state.tabs.length <= 1;
    close.innerHTML = `<i data-lucide="x"></i>`;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(file.id);
    });

    item.append(button, close);
    elements.tabStrip.append(item);
  }

  refreshIcons();
}

function getCurrentMarkdownText() {
  const file = getCurrentFile();
  if (!file) {
    return "";
  }

  if (document.activeElement === elements.markdownView || elements.markdownView.contains(document.activeElement)) {
    const markdown = markdownFromEditor(elements.markdownView);
    file.text = markdown;
    elements.sourceText.value = markdown;
    updateLineNumbers();
    return markdown;
  }

  return elements.sourceText.value;
}

function updateLineNumbers() {
  const lineCount = Math.max(1, elements.sourceText.value.split(/\r\n|\r|\n/).length);
  let numbers = "";
  for (let index = 1; index <= lineCount; index += 1) {
    numbers += `${index}${index === lineCount ? "" : "\n"}`;
  }
  elements.sourceLineNumbers.textContent = numbers;
  syncLineNumberScroll();
}

function syncLineNumberScroll() {
  elements.sourceLineNumbers.scrollTop = elements.sourceText.scrollTop;
}

function scheduleReadingPositionSave() {
  if (state.restoringPosition) {
    return;
  }

  clearTimeout(state.positionTimer);
  state.positionTimer = setTimeout(saveCurrentReadingPosition, 120);
}

function saveCurrentReadingPosition() {
  const file = getCurrentFile();
  if (!file) {
    return;
  }

  const key = filePositionKey(file);
  const previous = state.readingPositions.get(key) || { previewTop: 0, sourceTop: 0 };
  const next = {
    previewTop: previous.previewTop || 0,
    sourceTop: previous.sourceTop || 0,
    updatedAt: Date.now(),
  };

  if (state.view !== "source") {
    next.previewTop = Math.max(0, Math.round(elements.previewPane.scrollTop));
  }

  if (state.view !== "live") {
    next.sourceTop = Math.max(0, Math.round(elements.sourceText.scrollTop));
  }

  state.readingPositions.set(key, next);
  persistReadingPositions();
}

function restoreReadingPosition(file) {
  const position = state.readingPositions.get(filePositionKey(file)) || { previewTop: 0, sourceTop: 0 };
  state.restoringPosition = true;

  requestAnimationFrame(() => {
    elements.previewPane.scrollTop = position.previewTop || 0;
    elements.sourceText.scrollTop = position.sourceTop || 0;
    syncLineNumberScroll();

    requestAnimationFrame(() => {
      state.restoringPosition = false;
      updateLiveLineNumbers(file.text || elements.sourceText.value);
    });
  });
}

function filePositionKey(file) {
  if (file.absolutePath) {
    return `absolute:${file.absolutePath.toLowerCase()}`;
  }

  const vaultPart = state.rootPath || state.vaultName || "loose";
  return `vault:${vaultPart}::${file.path || file.id}`;
}

function loadStoredReadingPositions() {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    return new Map(Object.entries(JSON.parse(raw)));
  } catch (error) {
    console.warn(error);
    return new Map();
  }
}

function persistReadingPositions() {
  try {
    const recent = Array.from(state.readingPositions.entries())
      .sort((left, right) => (right[1]?.updatedAt || 0) - (left[1]?.updatedAt || 0))
      .slice(0, 500);
    state.readingPositions = new Map(recent);
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.readingPositions)));
  } catch (error) {
    console.warn(error);
  }
}

function updateLiveLineNumbers(markdown) {
  elements.liveLineNumbers.textContent = "";

  if (state.view === "source") {
    return;
  }

  const markers = extractLiveLineMarkers(markdown);
  const anchors = getLiveLineAnchors();
  const count = Math.min(markers.length, anchors.length);
  const gutterTop = elements.liveLineNumbers.getBoundingClientRect().top;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index += 1) {
    const anchorTop = anchors[index].getBoundingClientRect().top;
    const marker = document.createElement("span");
    marker.className = "live-line-number";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = markers[index];
    marker.style.top = `${Math.max(0, Math.round(anchorTop - gutterTop + 2))}px`;
    fragment.append(marker);
  }

  elements.liveLineNumbers.append(fragment);
}

function getLiveLineAnchors() {
  const anchors = [];

  for (const child of elements.markdownView.children) {
    const tag = child.tagName.toLowerCase();

    if (tag === "ul" || tag === "ol") {
      anchors.push(...Array.from(child.querySelectorAll(":scope > li")));
      continue;
    }

    anchors.push(child);
  }

  return anchors.filter((anchor) => anchor.getClientRects().length);
}

function extractLiveLineMarkers(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const markers = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const lineNumber = index + 1;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      markers.push(lineNumber);
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (isHeadingLine(trimmed) || isHorizontalRuleLine(trimmed)) {
      markers.push(lineNumber);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      markers.push(lineNumber);
      index += 2;
      while (index < lines.length && isTableRowLine(lines[index])) {
        index += 1;
      }
      continue;
    }

    if (isListItemLine(line)) {
      markers.push(lineNumber);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      markers.push(lineNumber);
      index += 1;
      while (index < lines.length && (lines[index].trim().startsWith(">") || !lines[index].trim())) {
        index += 1;
      }
      continue;
    }

    markers.push(lineNumber);
    index += 1;
    while (index < lines.length && lines[index].trim() && !isRenderedBlockStart(lines, index)) {
      index += 1;
    }
  }

  return markers;
}

function isRenderedBlockStart(lines, index) {
  const line = lines[index];
  const trimmed = line.trim();
  return (
    trimmed.startsWith("```") ||
    trimmed.startsWith(">") ||
    isHeadingLine(trimmed) ||
    isHorizontalRuleLine(trimmed) ||
    isListItemLine(line) ||
    isTableStart(lines, index)
  );
}

function isHeadingLine(trimmed) {
  return /^#{1,6}\s+/.test(trimmed);
}

function isHorizontalRuleLine(trimmed) {
  return /^([-*_])(?:\s*\1){2,}$/.test(trimmed);
}

function isListItemLine(line) {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function isTableStart(lines, index) {
  return isTableRowLine(lines[index]) && isTableSeparatorLine(lines[index + 1] || "");
}

function isTableRowLine(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparatorLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderAll() {
  elements.vaultName.textContent = state.vaultName;
  elements.fileCount.textContent = `${state.files.length} ${state.files.length === 1 ? "note" : "notes"}`;
  renderVaultSwitcher();
  renderFileTree();
  renderTabs();
  renderQuickResults();
}

function renderFileTree() {
  elements.fileTree.textContent = "";
  const visibleFiles = getVisibleFiles(state.search);

  if (!visibleFiles.length) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = state.files.length ? "No matching notes." : "Open a folder or Markdown file.";
    elements.fileTree.append(empty);
    return;
  }

  const tree = buildTree(visibleFiles);
  renderTreeNode(tree, elements.fileTree, "");
  refreshIcons();
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let currentPath = "";

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, path: currentPath, dirs: new Map(), files: [] });
      }

      node = node.dirs.get(part);
    }

    node.files.push(file);
  }

  return root;
}

function renderTreeNode(node, container, parentPath) {
  const sortedDirs = Array.from(node.dirs.values()).sort((left, right) => left.name.localeCompare(right.name));
  const sortedFiles = sortFilesForDisplay(node.files);

  for (const directory of sortedDirs) {
    const isOpen = state.search || state.treeOpen.has(directory.path);
    const group = document.createElement("div");
    group.className = "tree-group";

    const button = document.createElement("button");
    button.className = "tree-folder";
    button.type = "button";
    button.title = directory.path;
    button.innerHTML = `<i data-lucide="${isOpen ? "chevron-down" : "chevron-right"}"></i><span></span>`;
    button.querySelector("span").textContent = directory.name;
    button.addEventListener("click", () => {
      if (state.treeOpen.has(directory.path)) {
        state.treeOpen.delete(directory.path);
      } else {
        state.treeOpen.add(directory.path);
      }
      renderFileTree();
    });

    group.append(button);

    if (isOpen) {
      const children = document.createElement("div");
      children.className = "tree-children";
      renderTreeNode(directory, children, directory.path);
      group.append(children);
    }

    container.append(group);
  }

  for (const file of sortedFiles) {
    const button = document.createElement("button");
    button.className = `tree-file${file.id === state.currentId ? " is-active" : ""}${file.dirty ? " is-dirty" : ""}`;
    button.type = "button";
    button.title = fileTooltip(file);
    button.innerHTML = `<i data-lucide="file-text"></i><span></span>`;
    button.querySelector("span").textContent = file.title;
    button.addEventListener("click", () => selectFile(file.id));
    container.append(button);
  }
}

function getVisibleFiles(query) {
  const files = state.files;

  if (!query) {
    return sortFilesForDisplay(files);
  }

  return sortFilesForDisplay(files.filter((file) => {
    const pathMatch = file.path.toLowerCase().includes(query);
    const textMatch = typeof file.text === "string" && file.text.toLowerCase().includes(query);
    return pathMatch || textMatch;
  }));
}

function sortFilesForDisplay(files) {
  return [...files].sort(compareFiles);
}

function compareFiles(left, right) {
  let result = 0;

  if (state.sortKey === "modified") {
    result = compareNullableNumber(left.modified, right.modified, state.sortDirection);
  } else if (state.sortKey === "created") {
    result = compareNullableNumber(left.created, right.created, state.sortDirection);
  } else if (state.sortKey === "size") {
    result = compareNullableNumber(left.size, right.size, state.sortDirection);
  } else {
    result = compareText(left.title || left.name, right.title || right.name, state.sortDirection);
  }

  if (result !== 0) {
    return result;
  }

  return compareText(left.path || left.name, right.path || right.name, "asc");
}

function compareText(left, right, direction) {
  const result = String(left || "").localeCompare(String(right || ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });

  return direction === "desc" ? -result : result;
}

function compareNullableNumber(left, right, direction) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftHasValue = Number.isFinite(leftNumber) && leftNumber > 0;
  const rightHasValue = Number.isFinite(rightNumber) && rightNumber > 0;

  if (leftHasValue && !rightHasValue) {
    return -1;
  }

  if (!leftHasValue && rightHasValue) {
    return 1;
  }

  if (!leftHasValue && !rightHasValue) {
    return 0;
  }

  const result = leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  return direction === "desc" ? -result : result;
}

function renderQuickResults() {
  elements.quickResults.textContent = "";
  const results = getVisibleFiles(state.quickSearch).slice(0, 80);

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = "No matching notes.";
    elements.quickResults.append(empty);
    return;
  }

  for (const [index, file] of results.entries()) {
    const button = document.createElement("button");
    button.className = `quick-result${index === 0 ? " is-active" : ""}`;
    button.type = "button";
    button.dataset.fileId = file.id;
    button.title = fileTooltip(file);
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = file.title;
    button.querySelector("span").textContent = file.path;
    button.addEventListener("click", () => {
      selectFile(file.id);
      hideQuickOpen();
    });
    elements.quickResults.append(button);
  }
}

function fileTooltip(file) {
  return [
    file.path,
    `Created: ${formatFileTime(file.created)}`,
    `Modified: ${formatFileTime(file.modified)}`,
  ].join("\n");
}

function formatFileTime(value) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function renderMarkdown(markdown) {
  const prepared = transformWikiLinks(markdown);

  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({
      async: false,
      breaks: false,
      gfm: true,
      mangle: false,
      headerIds: false,
    });
    return window.DOMPurify.sanitize(window.marked.parse(prepared), {
      ADD_ATTR: ["target"],
    });
  }

  return miniMarkdown(prepared);
}

function markdownFromEditor(root) {
  const blocks = Array.from(root.childNodes)
    .map((node) => blockToMarkdown(node, 0))
    .filter((value) => value !== null);

  return normalizeMarkdown(blocks.join("\n\n"));
}

function blockToMarkdown(node, depth) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeInlineText(node.textContent || "");
    return text.trim() ? text : null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `${"#".repeat(level)} ${inlineMarkdownFromNode(node).trim()}`;
  }

  if (tag === "p" || tag === "div") {
    const text = inlineMarkdownFromNode(node).trim();
    return text || "";
  }

  if (tag === "br") {
    return "";
  }

  if (tag === "blockquote") {
    const text = Array.from(node.childNodes)
      .map((child) => blockToMarkdown(child, depth))
      .filter((value) => value !== null)
      .join("\n\n")
      .trim();
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (tag === "pre") {
    const code = node.querySelector("code");
    const language = code?.className?.match(/language-([^\s]+)/)?.[1] || "";
    return `\`\`\`${language}\n${(node.textContent || "").replace(/\n+$/, "")}\n\`\`\``;
  }

  if (tag === "ul" || tag === "ol") {
    return listMarkdownFromNode(node, depth, tag === "ol");
  }

  if (tag === "hr") {
    return "---";
  }

  if (tag === "table") {
    return tableMarkdownFromNode(node);
  }

  const childBlocks = Array.from(node.childNodes)
    .map((child) => blockToMarkdown(child, depth))
    .filter((value) => value !== null);
  return childBlocks.length ? childBlocks.join("\n\n") : inlineMarkdownFromNode(node).trim();
}

function listMarkdownFromNode(listNode, depth, ordered) {
  const items = Array.from(listNode.children).filter((child) => child.tagName?.toLowerCase() === "li");

  return items
    .map((item, index) => {
      const nestedLists = Array.from(item.children).filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()));
      const clone = item.cloneNode(true);
      Array.from(clone.children)
        .filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()))
        .forEach((child) => child.remove());

      const prefix = ordered ? `${index + 1}. ` : "- ";
      const indent = "  ".repeat(depth);
      const primary = `${indent}${prefix}${inlineMarkdownFromNode(clone).trim()}`;
      const nested = nestedLists
        .map((child) => listMarkdownFromNode(child, depth + 1, child.tagName.toLowerCase() === "ol"))
        .join("\n");

      return nested ? `${primary}\n${nested}` : primary;
    })
    .join("\n");
}

function tableMarkdownFromNode(tableNode) {
  const rows = Array.from(tableNode.querySelectorAll("tr")).map((row) =>
    Array.from(row.children).map((cell) => inlineMarkdownFromNode(cell).trim().replace(/\|/g, "\\|"))
  );

  if (!rows.length) {
    return "";
  }

  const header = rows[0];
  const separator = header.map(() => "---");
  const body = rows.slice(1);
  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function inlineMarkdownFromNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(normalizeInlineText(node.textContent || ""));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const childText = () => Array.from(node.childNodes).map(inlineMarkdownFromNode).join("");

  if (tag === "br") {
    return "\n";
  }

  if (tag === "strong" || tag === "b") {
    const text = childText();
    return text.trim() ? `**${text}**` : "";
  }

  if (tag === "em" || tag === "i") {
    const text = childText();
    return text.trim() ? `*${text}*` : "";
  }

  if (tag === "code") {
    return `\`${(node.textContent || "").replace(/`/g, "\\`")}\``;
  }

  if (tag === "a") {
    const label = childText().trim() || node.textContent.trim();
    const href = node.getAttribute("href") || "";
    if (href.startsWith("#wiki:")) {
      return `[[${decodeURIComponent(href.slice(6))}${label && label !== decodeURIComponent(href.slice(6)) ? `|${label}` : ""}]]`;
    }
    return href ? `[${label}](${href})` : label;
  }

  if (tag === "img") {
    const alt = node.getAttribute("alt") || "";
    const src = node.getAttribute("src") || "";
    return src ? `![${alt}](${src})` : "";
  }

  return childText();
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .concat("\n");
}

function normalizeInlineText(text) {
  return text.replace(/\u00a0/g, " ");
}

function escapeMarkdownText(text) {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function transformWikiLinks(markdown) {
  return markdown.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => {
    const label = alias || target;
    return `[${label}](#wiki:${encodeURIComponent(target.trim())})`;
  });
}

function miniMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inList = false;
  let inCode = false;
  let codeLanguage = "";
  let codeLines = [];

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
        html.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeLanguage = "";
        inCode = false;
      } else {
        closeList();
        inCode = true;
        codeLanguage = line.slice(3).trim().split(/\s+/)[0] || "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("\n");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function decorateRenderedNote(markdown) {
  decorateHeadings();
  renderOutline(extractHeadings(markdown));
  refreshIcons();
}

function decorateHeadings() {
  const used = new Map();
  const headings = elements.markdownView.querySelectorAll("h1, h2, h3, h4");

  headings.forEach((heading) => {
    const base = slugify(heading.textContent || "section");
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    heading.id = count ? `${base}-${count + 1}` : base;
  });
}

function renderOutline(headings) {
  elements.outline.textContent = "";

  if (!headings.length) {
    const empty = document.createElement("div");
    empty.className = "empty-subtle";
    empty.textContent = "No headings.";
    elements.outline.append(empty);
    return;
  }

  const used = new Map();
  for (const heading of headings) {
    const base = slugify(heading.text);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const id = count ? `${base}-${count + 1}` : base;

    const link = document.createElement("a");
    link.href = `#${id}`;
    link.className = `level-${Math.min(heading.level, 4)}`;
    link.textContent = heading.text;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      elements.markdownView.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.outline.append(link);
  }
}

function extractHeadings(markdown) {
  const headings = [];
  let inCode = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }

    const match = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        text: stripInlineMarkdown(match[2]).trim(),
      });
    }
  }

  return headings;
}

function updateDetails(markdown) {
  const plain = stripInlineMarkdown(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_\-[\]()`]/g, " ");
  const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;
  const lines = Math.max(1, markdown.split(/\r\n|\r|\n/).length);
  const links = (markdown.match(/\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]/g) || []).length;
  const minutes = Math.max(1, Math.ceil(words / 220));

  elements.wordCount.textContent = words.toLocaleString();
  elements.lineCount.textContent = lines.toLocaleString();
  elements.readingTime.textContent = `${minutes} min`;
  elements.linkCount.textContent = links.toLocaleString();
}

function updateBacklinks() {
  elements.backlinks.textContent = "";
  const current = state.files.find((file) => file.id === state.currentId);

  if (!current) {
    return;
  }

  const currentStem = stripExtension(current.name).toLowerCase();
  const currentPath = current.path.toLowerCase();
  const mentions = state.files
    .filter((file) => file.id !== current.id && typeof file.text === "string")
    .filter((file) => noteMentions(file.text, currentStem, currentPath));

  if (!mentions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-subtle";
    empty.textContent = state.indexed ? "No linked mentions." : "Indexing notes.";
    elements.backlinks.append(empty);
    return;
  }

  for (const file of mentions.slice(0, 24)) {
    const button = document.createElement("button");
    button.className = "backlink";
    button.type = "button";
    button.textContent = file.title;
    button.title = file.path;
    button.addEventListener("click", () => selectFile(file.id));
    elements.backlinks.append(button);
  }
}

function noteMentions(text, stem, path) {
  const normalized = text.toLowerCase();
  const escapedStem = escapeRegExp(stem);
  return (
    new RegExp(`\\[\\[\\s*${escapedStem}(?:[#|\\]])`, "i").test(text) ||
    normalized.includes(`](${path})`) ||
    normalized.includes(`](${path.replace(/ /g, "%20")})`) ||
    normalized.includes(`](${stem}.md)`)
  );
}

function handlePreviewClick(event) {
  const anchor = event.target.closest("a");
  if (!anchor) {
    return;
  }

  const href = anchor.getAttribute("href") || "";

  if ((state.view === "live" || state.view === "split") && !(event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    return;
  }

  if (/^https?:\/\//i.test(href) && window.vaultReaderNative) {
    event.preventDefault();
    window.vaultReaderNative.openExternal(href);
    return;
  }

  if (href.startsWith("#wiki:")) {
    event.preventDefault();
    openByReference(decodeURIComponent(href.slice(6)));
    return;
  }

  if (/\.m(?:d|arkdown|down)(?:#.*)?$/i.test(href)) {
    event.preventDefault();
    openByReference(decodeURIComponent(href.split("#")[0]));
  }
}

function openByReference(reference) {
  const normalized = reference.trim().replace(/\\/g, "/").toLowerCase();
  const stem = stripExtension(normalized.split("/").pop() || normalized);

  const exactPath = state.files.find((file) => file.path.toLowerCase() === normalized);
  const byName = state.files.find((file) => stripExtension(file.name).toLowerCase() === stem);
  const byPathEnd = state.files.find((file) => file.path.toLowerCase().endsWith(normalized));

  const target = exactPath || byPathEnd || byName;
  if (target) {
    selectFile(target.id);
  }
}

function showQuickOpen() {
  elements.quickOpen.hidden = false;
  state.quickSearch = "";
  elements.quickSearch.value = "";
  renderQuickResults();
  requestAnimationFrame(() => elements.quickSearch.focus());
}

function hideQuickOpen() {
  elements.quickOpen.hidden = true;
  elements.quickSearch.blur();
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("vault-reader-theme", state.theme);
  syncThemeButton();
  refreshIcons();
}

function syncThemeButton() {
  elements.toggleThemeButton.innerHTML = `<i data-lucide="${state.theme === "dark" ? "moon" : "sun"}"></i>`;
}

function toggleSidebar() {
  setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
}

function setSidebarCollapsed(isCollapsed) {
  elements.appShell.classList.toggle("sidebar-collapsed", isCollapsed);
  elements.collapseSidebarButton.innerHTML = `<i data-lucide="${isCollapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
  elements.showSidebarButton.hidden = !isCollapsed;
  refreshIcons();
}

function setView(view) {
  const file = getCurrentFile();
  saveCurrentReadingPosition();
  state.view = view;
  elements.appShell.dataset.view = view;
  elements.markdownView.contentEditable = view === "source" ? "false" : "true";
  elements.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewMode === view);
  });

  if (view === "live" || view === "split") {
    if (file) {
      renderCurrentMarkdown(file.text || elements.sourceText.value);
    }
  }

  updateLineNumbers();
  if (view === "source") {
    updateLiveLineNumbers("");
  }
  if (file) {
    restoreReadingPosition(file);
  }
}

function setIndexStatus(value) {
  elements.indexStatus.textContent = value;
}

function isMarkdownFile(name) {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name));
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function stripExtension(name) {
  return name.replace(/\.(md|markdown|mdown)$/i, "");
}

function normalizeNoteFileName(name) {
  const fallback = "Untitled";
  const cleaned = (name || fallback)
    .trim()
    .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, fallback);
  const base = cleaned || fallback;
  return isMarkdownFile(base) ? base : `${base}.md`;
}

function nextUntitledName() {
  const existing = new Set(state.files.map((file) => file.name.toLowerCase()));
  let index = 1;
  let candidate = "Untitled.md";

  while (existing.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `Untitled ${index}.md`;
  }

  return candidate;
}

function uniqueIds(ids) {
  return Array.from(new Set(ids));
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function collectParentFolders(path, folders) {
  const parts = path.split("/");
  let current = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current ? `${current}/${parts[index]}` : parts[index];
    folders.add(current);
  }
}

function stripInlineMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)]]/g, (_match, first, second) => second || first)
    .replace(/[*_~>#-]/g, " ");
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTauriInvoke() {
  return window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
}

boot();
