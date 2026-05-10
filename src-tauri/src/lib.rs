use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SKIPPED_DIRS: &[&str] = &[".git", ".obsidian", "node_modules", ".trash"];

#[derive(Serialize)]
struct OpenResult {
    #[serde(rename = "vaultName")]
    vault_name: String,
    #[serde(rename = "rootPath")]
    root_path: Option<String>,
    #[serde(rename = "selectedId", skip_serializing_if = "Option::is_none")]
    selected_id: Option<String>,
    folders: Vec<String>,
    files: Vec<FileEntry>,
}

#[derive(Serialize)]
struct FileEntry {
    id: String,
    #[serde(rename = "absolutePath")]
    absolute_path: String,
    path: String,
    name: String,
    title: String,
    directory: String,
    text: Option<String>,
    size: u64,
    created: u128,
    modified: u128,
    #[serde(rename = "isDisk")]
    is_disk: bool,
}

#[derive(Serialize)]
struct FolderList {
    path: String,
    name: String,
    #[serde(rename = "parentPath")]
    parent_path: Option<String>,
    roots: Vec<FolderEntry>,
    folders: Vec<FolderEntry>,
}

#[derive(Serialize, Clone)]
struct FolderEntry {
    name: String,
    path: String,
}

#[tauri::command]
fn load_paths(paths: Vec<String>) -> Result<OpenResult, String> {
    associated_paths_result(paths)
}

fn associated_paths_result(paths: Vec<String>) -> Result<OpenResult, String> {
    let target_paths = collect_markdown_paths(paths);
    if target_paths.is_empty() {
        return Ok(empty_open_result());
    }

    let first_parent = target_paths[0].parent().map(|path| path.to_path_buf()).unwrap_or_default();
    let same_parent = target_paths.iter().all(|path| path.parent().unwrap_or_else(|| Path::new("")) == first_parent);

    if same_parent {
        let root_path = first_parent;
        let mut files = Vec::new();
        let mut folders = Vec::new();
        walk_directory(&root_path, &root_path, &mut files, &mut folders)?;
        files.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
        folders.sort();
        folders.dedup();
        let selected_id = find_selected_id(&files, &target_paths[0]);

        return Ok(OpenResult {
            vault_name: root_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Vault")
                .to_string(),
            root_path: Some(root_path.to_string_lossy().to_string()),
            selected_id,
            folders,
            files,
        });
    }

    selected_files_result(target_paths)
}

fn selected_files_result(paths: Vec<PathBuf>) -> Result<OpenResult, String> {
    let mut files = Vec::new();

    for absolute_path in &paths {
        let root = absolute_path.parent().unwrap_or_else(|| Path::new(""));
        files.push(file_entry(absolute_path, root)?);
    }

    files.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));

    if files.is_empty() {
        return Ok(empty_open_result());
    }

    let vault_name = if files.len() == 1 {
        strip_extension(&files[0].name)
    } else {
        "Loose files".to_string()
    };

    Ok(OpenResult {
        vault_name,
        root_path: None,
        selected_id: find_selected_id(&files, &paths[0]),
        folders: Vec::new(),
        files,
    })
}

fn folder_result(root_path: PathBuf) -> Result<OpenResult, String> {
    if !root_path.is_dir() {
        return Err("Vault path is not a folder.".to_string());
    }

    let mut files = Vec::new();
    let mut folders = Vec::new();
    walk_directory(&root_path, &root_path, &mut files, &mut folders)?;
    files.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    folders.sort();
    folders.dedup();

    Ok(OpenResult {
        vault_name: root_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Vault")
            .to_string(),
        root_path: Some(root_path.to_string_lossy().to_string()),
        selected_id: None,
        folders,
        files,
    })
}

#[tauri::command]
fn open_folder() -> Result<Option<OpenResult>, String> {
    let Some(root_path) = rfd::FileDialog::new().set_title("Open Markdown folder").pick_folder() else {
        return Ok(None);
    };

    folder_result(root_path).map(Some)
}

#[tauri::command]
fn open_vault_path(root_path: String) -> Result<Option<OpenResult>, String> {
    folder_result(PathBuf::from(root_path)).map(Some)
}

#[tauri::command]
fn list_folder(folder_path: Option<String>) -> Result<FolderList, String> {
    let current_path = navigator_path(folder_path)?;
    let mut folders = Vec::new();

    for entry in fs::read_dir(&current_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if SKIPPED_DIRS.contains(&name.as_str()) {
            continue;
        }

        folders.push(FolderEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
        });
    }

    folders.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    let name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| current_path.to_string_lossy().to_string());

    Ok(FolderList {
        name,
        parent_path: parent_folder_path(&current_path),
        path: current_path.to_string_lossy().to_string(),
        roots: system_roots(),
        folders,
    })
}

#[tauri::command]
fn open_files() -> Result<Option<OpenResult>, String> {
    let Some(paths) = rfd::FileDialog::new()
        .set_title("Open Markdown files")
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .pick_files()
    else {
        return Ok(None);
    };

    selected_files_result(paths).map(Some)
}

#[tauri::command]
fn read_file(absolute_path: String) -> Result<String, String> {
    fs::read_to_string(absolute_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_file(absolute_path: String, text: String) -> Result<bool, String> {
    fs::write(absolute_path, text).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn create_note(root_path: Option<String>, name: String, text: String) -> Result<Option<FileEntry>, String> {
    let file_name = normalize_note_name(&name);
    let target_path = if let Some(root_path) = root_path {
        unique_path(PathBuf::from(root_path).join(file_name))?
    } else {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Create note")
            .set_file_name(&file_name)
            .add_filter("Markdown", &["md", "markdown", "mdown"])
            .save_file()
        else {
            return Ok(None);
        };
        path
    };

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&target_path, text).map_err(|error| error.to_string())?;
    let root = target_path.parent().unwrap_or_else(|| Path::new(""));
    file_entry(&target_path, root).map(Some)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_paths = markdown_args();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_note,
            load_paths,
            list_folder,
            open_files,
            open_folder,
            open_vault_path,
            read_file,
            write_file
        ])
        .setup(move |app| {
            if !initial_paths.is_empty() {
                if let Some(window) = app.get_webview_window("main") {
                    let payload = serde_json::to_string(&initial_paths)?;
                    window.eval(&format!(
                        "window.__VAULT_READER_TAURI_OPEN_PATHS = {payload}; window.dispatchEvent(new CustomEvent('vault-reader-open-paths', {{ detail: {payload} }}));"
                    ))?;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Vault Reader");
}

fn markdown_args() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("--"))
        .filter(|arg| is_markdown_file(Path::new(arg)))
        .collect()
}

fn navigator_path(folder_path: Option<String>) -> Result<PathBuf, String> {
    let requested = folder_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_navigator_path);

    if !requested.is_dir() {
        return Err("Navigator path is not a folder.".to_string());
    }

    Ok(requested)
}

fn default_navigator_path() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .ok()
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn parent_folder_path(folder_path: &Path) -> Option<String> {
    folder_path.parent().and_then(|parent| {
        if parent == folder_path {
            None
        } else {
            Some(parent.to_string_lossy().to_string())
        }
    })
}

fn system_roots() -> Vec<FolderEntry> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).is_dir() {
                roots.push(FolderEntry {
                    name: root.clone(),
                    path: root,
                });
            }
        }
        roots
    }

    #[cfg(not(windows))]
    {
        vec![FolderEntry {
            name: "/".to_string(),
            path: "/".to_string(),
        }]
    }
}

fn collect_markdown_paths(paths: Vec<String>) -> Vec<PathBuf> {
    let mut target_paths = Vec::new();
    let mut seen = Vec::new();

    for supplied_path in paths {
        let absolute_path = PathBuf::from(supplied_path);
        let key = path_key(&absolute_path);
        if seen.contains(&key) {
            continue;
        }

        if absolute_path.is_file() && is_markdown_file(&absolute_path) {
            seen.push(key);
            target_paths.push(absolute_path);
        }
    }

    target_paths
}

fn empty_open_result() -> OpenResult {
    OpenResult {
        vault_name: "Loose files".to_string(),
        root_path: None,
        selected_id: None,
        folders: Vec::new(),
        files: Vec::new(),
    }
}

fn find_selected_id(files: &[FileEntry], selected_path: &Path) -> Option<String> {
    let selected_key = path_key(selected_path);
    files
        .iter()
        .find(|file| path_key(Path::new(&file.absolute_path)) == selected_key)
        .or_else(|| files.first())
        .map(|file| file.id.clone())
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn file_entry(absolute_path: &Path, root_path: &Path) -> Result<FileEntry, String> {
    let metadata = fs::metadata(absolute_path).map_err(|error| error.to_string())?;
    let name = absolute_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.md")
        .to_string();
    let relative_path = absolute_path
        .strip_prefix(root_path)
        .unwrap_or(absolute_path)
        .to_string_lossy()
        .replace('\\', "/");
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let created = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    let path = if relative_path.is_empty() { name.clone() } else { relative_path };

    Ok(FileEntry {
        id: format!("disk:{}", absolute_path.to_string_lossy()),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        directory: parent_path(&path),
        path,
        title: strip_extension(&name),
        name,
        text: None,
        size: metadata.len(),
        created,
        modified,
        is_disk: true,
    })
}

fn walk_directory(root_path: &Path, current_path: &Path, files: &mut Vec<FileEntry>, folders: &mut Vec<String>) -> Result<(), String> {
    let mut entries = fs::read_dir(current_path)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    entries.sort_by(|left, right| {
        let left_is_dir = left.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let right_is_dir = right.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        right_is_dir
            .cmp(&left_is_dir)
            .then_with(|| left.file_name().to_string_lossy().to_lowercase().cmp(&right.file_name().to_string_lossy().to_lowercase()))
    });

    for entry in entries {
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            folders.push(to_vault_path(entry_path.strip_prefix(root_path).unwrap_or(&entry_path)));
            walk_directory(root_path, &entry_path, files, folders)?;
        } else if file_type.is_file() && is_markdown_file(&entry_path) {
            files.push(file_entry(&entry_path, root_path)?);
        }
    }

    Ok(())
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown"))
        .unwrap_or(false)
}

fn strip_extension(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name)
        .to_string()
}

fn normalize_note_name(name: &str) -> String {
    let mut cleaned = name
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/' => '-',
            ch if ch.is_control() => '-',
            ch => ch,
        })
        .collect::<String>();

    if cleaned.is_empty() {
        cleaned = "Untitled".to_string();
    }

    if is_markdown_file(Path::new(&cleaned)) {
        cleaned
    } else {
        format!("{cleaned}.md")
    }
}

fn unique_path(initial_path: PathBuf) -> Result<PathBuf, String> {
    if !initial_path.exists() {
        return Ok(initial_path);
    }

    let extension = initial_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md")
        .to_string();
    let stem = initial_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let parent = initial_path.parent().unwrap_or_else(|| Path::new(""));

    for index in 2..10000 {
        let candidate = parent.join(format!("{stem} {index}.{extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Could not create a unique note name.".to_string())
}

fn parent_path(value: &str) -> String {
    value
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

fn to_vault_path(value: &Path) -> String {
    value.to_string_lossy().replace('\\', "/")
}
