#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{DateTime, Utc};
use tauri::State;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    db,
    error::{AppError, ErrorResponse},
    models::{DesktopCategoryRecord, DesktopItemRecord, DesktopKind},
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub fn list_desktop_categories(
    state: State<'_, AppState>,
) -> Result<Vec<DesktopCategoryRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_desktop_categories(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn create_desktop_category(
    name: String,
    kind: DesktopKind,
    state: State<'_, AppState>,
) -> Result<DesktopCategoryRecord, ErrorResponse> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::File("分类名称不能为空".to_string()).into());
    }
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let next_order = db::list_desktop_categories(&conn)
        .map_err(AppError::from)?
        .iter()
        .map(|category| category.sort_order)
        .max()
        .unwrap_or(2)
        + 1;
    let category = DesktopCategoryRecord {
        id: Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        kind,
        sort_order: next_order,
        color: None,
        created_at: Utc::now().to_rfc3339(),
    };
    db::insert_desktop_category(&conn, &category).map_err(AppError::from)?;
    Ok(category)
}

#[tauri::command]
pub fn delete_desktop_category(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopCategoryRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let deleted = db::delete_desktop_category(&conn, &id).map_err(AppError::from)?;
    if deleted == 0 {
        return Err(AppError::NotFound("Desktop category".to_string()).into());
    }
    db::list_desktop_categories(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reorder_desktop_categories(
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopCategoryRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::update_desktop_category_order(&conn, &ordered_ids).map_err(AppError::from)?;
    db::list_desktop_categories(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_desktop_items(
    category_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopItemRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_desktop_items(&conn, &category_id)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn add_desktop_paths(
    paths: Vec<String>,
    target_category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopItemRecord>, ErrorResponse> {
    let categories = {
        let conn = state
            .conn
            .lock()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let mut cats = db::list_desktop_categories(&conn).map_err(AppError::from)?;

        let all_kinds = [
            (DesktopKind::Software, "software", "软件"),
            (DesktopKind::File, "files", "文件"),
            (DesktopKind::Folder, "folders", "文件夹"),
        ];
        for (kind, default_id, default_name) in &all_kinds {
            if !cats.iter().any(|c| c.kind == *kind) {
                let default_category = DesktopCategoryRecord {
                    id: default_id.to_string(),
                    name: default_name.to_string(),
                    kind: kind.clone(),
                    sort_order: 0,
                    color: None,
                    created_at: Utc::now().to_rfc3339(),
                };
                db::insert_desktop_category(&conn, &default_category).map_err(AppError::from)?;
                cats.push(default_category);
            }
        }
        cats.sort_by_key(|c| c.sort_order);
        cats
    };

    let pending = desktop_items_for_paths(
        paths,
        &categories,
        target_category_id.as_deref(),
        &state.icons_dir,
    )?;
    if pending.is_empty() {
        return Err(AppError::File("没有可添加的有效路径".to_string()).into());
    }

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;

    let mut existing_paths: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT path FROM desktop_items")
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        existing_paths.extend(rows);
    }

    let mut final_pending: Vec<DesktopItemRecord> = pending
        .into_iter()
        .filter(|item| !existing_paths.contains(&item.path))
        .collect();

    if final_pending.is_empty() {
        return Err(AppError::File("所有拖入的路径都已存在。".to_string()).into());
    }

    let mut next_orders: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for item in &mut final_pending {
        let order = next_orders
            .entry(item.category_id.clone())
            .or_insert_with(|| db::compute_next_sort_order(&conn, &item.category_id).unwrap_or(0));
        item.sort_order = *order;
        *order += 1;
    }

    for item in &final_pending {
        db::insert_desktop_item(&conn, item).map_err(AppError::from)?;
    }

    Ok(final_pending)
}

fn desktop_items_for_paths(
    paths: Vec<String>,
    categories: &[DesktopCategoryRecord],
    target_category_id: Option<&str>,
    icons_dir: &Path,
) -> Result<Vec<DesktopItemRecord>, AppError> {
    let mut items = Vec::new();

    for path in paths {
        let path_buf = PathBuf::from(&path);
        if !path_buf.exists() {
            eprintln!("Skipped missing dropped path: {path}");
            continue;
        }
        let metadata = std::fs::metadata(&path_buf).map_err(AppError::from)?;
        let kind = kind_for_path(&path_buf, metadata.is_dir());
        let category_id = category_id_for_kind(categories, &kind, target_category_id).to_string();
        let modified_at = metadata.modified().ok().map(|time| {
            let datetime: DateTime<Utc> = time.into();
            datetime.to_rfc3339()
        });
        let name = item_name_for_path(&path_buf, &path, &kind);
        let icon_path = software_icon_path(&path_buf, icons_dir, &kind);
        let now = Utc::now().to_rfc3339();
        let item = DesktopItemRecord {
            id: Uuid::new_v4().to_string(),
            category_id,
            name,
            path,
            kind,
            modified_at,
            icon_path,
            sort_order: 0,
            created_at: now,
        };
        items.push(item);
    }

    Ok(items)
}

#[tauri::command]
pub fn open_desktop_item(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let item = db::find_desktop_item(&conn, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Desktop item".to_string()))?;
    if !Path::new(&item.path).exists() {
        return Err(AppError::File(format!("路径不存在：{}", item.path)).into());
    }
    tauri_plugin_opener::open_path(&item.path, None::<&str>)
        .map_err(|error| AppError::File(error.to_string()))
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_desktop_item(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let deleted = db::delete_desktop_item(&conn, &id).map_err(AppError::from)?;
    if deleted == 0 {
        return Err(AppError::NotFound("Desktop item".to_string()).into());
    }
    Ok(())
}

#[tauri::command]
pub fn rename_desktop_item(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<DesktopItemRecord, ErrorResponse> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::File("名称不能为空".to_string()).into());
    }
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let updated = db::update_desktop_item_name(&conn, &id, trimmed).map_err(AppError::from)?;
    if updated == 0 {
        return Err(AppError::NotFound("Desktop item".to_string()).into());
    }
    db::find_desktop_item(&conn, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Desktop item".to_string()).into())
}

#[tauri::command]
pub fn move_desktop_item_to_category(
    id: String,
    target_category_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopItemRecord, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let item = db::find_desktop_item(&conn, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Desktop item".to_string()))?;
    let target_category = db::list_desktop_categories(&conn)
        .map_err(AppError::from)?
        .into_iter()
        .find(|category| category.id == target_category_id)
        .ok_or_else(|| AppError::NotFound("Desktop category".to_string()))?;

    if target_category.kind != item.kind {
        return Err(AppError::File("目标分页类型不匹配".to_string()).into());
    }
    if item.category_id == target_category_id {
        return Ok(item);
    }

    let sort_order =
        db::compute_next_sort_order(&conn, &target_category_id).map_err(AppError::from)?;
    let updated = db::update_desktop_item_category(&conn, &id, &target_category_id, sort_order)
        .map_err(AppError::from)?;
    if updated == 0 {
        return Err(AppError::NotFound("Desktop item".to_string()).into());
    }
    db::find_desktop_item(&conn, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Desktop item".to_string()).into())
}

#[tauri::command]
pub fn update_desktop_category_color(
    id: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopCategoryRecord>, ErrorResponse> {
    let normalized = color
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    if let Some(color) = normalized.as_deref() {
        if !is_hex_color(color) {
            return Err(AppError::File("颜色格式无效".to_string()).into());
        }
    }

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let updated = db::update_desktop_category_color(&conn, &id, normalized.as_deref())
        .map_err(AppError::from)?;
    if updated == 0 {
        return Err(AppError::NotFound("Desktop category".to_string()).into());
    }
    db::list_desktop_categories(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reorder_desktop_items(
    category_id: String,
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::reorder_desktop_items(&conn, &category_id, &ordered_ids).map_err(AppError::from)?;
    Ok(())
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|char| char.is_ascii_hexdigit())
}

pub fn kind_for_path(path: &Path, is_dir: bool) -> DesktopKind {
    if is_dir {
        return DesktopKind::Folder;
    }
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension)
            if extension.eq_ignore_ascii_case("lnk") || extension.eq_ignore_ascii_case("exe") =>
        {
            DesktopKind::Software
        }
        _ => DesktopKind::File,
    }
}

fn item_name_for_path(path: &Path, fallback: &str, kind: &DesktopKind) -> String {
    let extension = path.extension().and_then(|value| value.to_str());
    if matches!(kind, DesktopKind::Software)
        && extension.is_some_and(|value| {
            value.eq_ignore_ascii_case("lnk") || value.eq_ignore_ascii_case("exe")
        })
    {
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            return stem.to_string();
        }
    }

    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback)
        .to_string()
}

fn default_category_id_for_kind<'a>(
    categories: &'a [DesktopCategoryRecord],
    kind: &DesktopKind,
) -> &'a str {
    categories
        .iter()
        .find(|category| category.kind == *kind)
        .map(|category| category.id.as_str())
        .unwrap_or(match kind {
            DesktopKind::Software => "software",
            DesktopKind::File => "files",
            DesktopKind::Folder => "folders",
        })
}

fn category_id_for_kind<'a>(
    categories: &'a [DesktopCategoryRecord],
    kind: &DesktopKind,
    target_category_id: Option<&str>,
) -> &'a str {
    if let Some(target_category_id) = target_category_id {
        if let Some(category) = categories
            .iter()
            .find(|category| category.id == target_category_id && category.kind == *kind)
        {
            return category.id.as_str();
        }
    }

    default_category_id_for_kind(categories, kind)
}

fn software_icon_path(path: &Path, icons_dir: &Path, kind: &DesktopKind) -> Option<String> {
    if !matches!(kind, DesktopKind::Software) {
        return None;
    }

    let icon_path = crate::icon_util::icon_cache_path(icons_dir, path);
    if let Some(parent) = icon_path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            eprintln!("Failed to create icon cache directory {}: {err}", parent.display());
        }
    }

    let script = r#"
$ErrorActionPreference = 'Stop'
$SourcePath = $env:ODM_SOURCE_PATH
$IconPath = $env:ODM_ICON_PATH
$source = $SourcePath
if ([IO.Path]::GetExtension($SourcePath).Equals('.lnk', [StringComparison]::OrdinalIgnoreCase)) {
    $wsh = New-Object -ComObject WScript.Shell
    $link = $wsh.CreateShortcut($SourcePath)
    $target = [Environment]::ExpandEnvironmentVariables([string]$link.TargetPath)
    if (-not [string]::IsNullOrWhiteSpace($target) -and (Test-Path -LiteralPath $target)) {
        $source = $target
    }
}
if (-not [string]::IsNullOrWhiteSpace($source) -and (Test-Path -LiteralPath $source)) {
    Add-Type -AssemblyName System.Drawing
    $icon = $null
    $bitmap = $null
    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source)
        if ($null -ne $icon) {
            $bitmap = $icon.ToBitmap()
            $bitmap.Save($IconPath, [System.Drawing.Imaging.ImageFormat]::Png)
        }
    } finally {
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $icon) { $icon.Dispose() }
    }
}
"#;

    let source_path = path.to_string_lossy().into_owned();
    let icon_path_str = icon_path.to_string_lossy().into_owned();
    let mut command = Command::new("powershell.exe");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("ODM_SOURCE_PATH", &source_path)
        .env("ODM_ICON_PATH", &icon_path_str)
        .output();

    if output.is_ok_and(|output| output.status.success()) && icon_path.exists() {
        Some(icon_path.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn kind_for_path_routes_default_types() {
        assert_eq!(
            kind_for_path(Path::new(r"C:\Apps\Code.exe"), false),
            DesktopKind::Software
        );
        assert_eq!(
            kind_for_path(Path::new(r"C:\Users\me\Desktop\App.lnk"), false),
            DesktopKind::Software
        );
        assert_eq!(
            kind_for_path(Path::new(r"C:\Users\me\Desktop\方案.docx"), false),
            DesktopKind::File
        );
        assert_eq!(
            kind_for_path(Path::new(r"C:\Users\me\Desktop\Work"), true),
            DesktopKind::Folder
        );
    }

    #[test]
    fn desktop_items_for_paths_skips_missing_paths() {
        let temp_dir = std::env::temp_dir().join(format!(
            "offline-desktop-manager-drop-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let existing_file = temp_dir.join("方案.txt");
        let missing_file = temp_dir.join("missing.txt");
        std::fs::write(&existing_file, b"ok").expect("create existing file");
        let categories = vec![
            DesktopCategoryRecord {
                id: "software".to_string(),
                name: "软件".to_string(),
                kind: DesktopKind::Software,
                sort_order: 0,
                color: None,
                created_at: "1970-01-01T00:00:00Z".to_string(),
            },
            DesktopCategoryRecord {
                id: "files".to_string(),
                name: "文件".to_string(),
                kind: DesktopKind::File,
                sort_order: 1,
                color: None,
                created_at: "1970-01-01T00:00:00Z".to_string(),
            },
        ];

        let items = desktop_items_for_paths(
            vec![
                missing_file.to_string_lossy().into_owned(),
                existing_file.to_string_lossy().into_owned(),
            ],
            &categories,
            None,
            &temp_dir,
        )
        .expect("build desktop items");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, existing_file.to_string_lossy());
        assert_eq!(items[0].category_id, "files");
        assert_eq!(items[0].kind, DesktopKind::File);

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn software_item_names_omit_shortcut_and_exe_extensions() {
        let temp_dir = std::env::temp_dir().join(format!(
            "offline-desktop-manager-name-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let shortcut = temp_dir.join("Code.lnk");
        let executable = temp_dir.join("Tool.exe");
        std::fs::write(&shortcut, b"shortcut").expect("create shortcut");
        std::fs::write(&executable, b"exe").expect("create executable");
        let categories = vec![DesktopCategoryRecord {
            id: "software".to_string(),
            name: "软件".to_string(),
            kind: DesktopKind::Software,
            sort_order: 0,
            color: None,
            created_at: "1970-01-01T00:00:00Z".to_string(),
        }];

        let items = desktop_items_for_paths(
            vec![
                shortcut.to_string_lossy().into_owned(),
                executable.to_string_lossy().into_owned(),
            ],
            &categories,
            None,
            &temp_dir,
        )
        .expect("build desktop items");

        assert_eq!(items[0].name, "Code");
        assert_eq!(items[1].name, "Tool");

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn desktop_items_for_paths_uses_target_category_only_when_kind_matches() {
        let temp_dir = std::env::temp_dir().join(format!(
            "offline-desktop-manager-target-category-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let file = temp_dir.join("方案.txt");
        std::fs::write(&file, b"ok").expect("create file");
        let categories = vec![
            DesktopCategoryRecord {
                id: "software".to_string(),
                name: "软件".to_string(),
                kind: DesktopKind::Software,
                sort_order: 0,
                color: None,
                created_at: "1970-01-01T00:00:00Z".to_string(),
            },
            DesktopCategoryRecord {
                id: "files".to_string(),
                name: "文件".to_string(),
                kind: DesktopKind::File,
                sort_order: 1,
                color: None,
                created_at: "1970-01-01T00:00:00Z".to_string(),
            },
            DesktopCategoryRecord {
                id: "project-files".to_string(),
                name: "项目文件".to_string(),
                kind: DesktopKind::File,
                sort_order: 2,
                color: None,
                created_at: "1970-01-01T00:00:00Z".to_string(),
            },
        ];

        let matching_items = desktop_items_for_paths(
            vec![file.to_string_lossy().into_owned()],
            &categories,
            Some("project-files"),
            &temp_dir,
        )
        .expect("build matching target items");
        assert_eq!(matching_items[0].category_id, "project-files");

        let mismatched_items = desktop_items_for_paths(
            vec![file.to_string_lossy().into_owned()],
            &categories,
            Some("software"),
            &temp_dir,
        )
        .expect("build mismatched target items");
        assert_eq!(mismatched_items[0].category_id, "files");

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }
}
