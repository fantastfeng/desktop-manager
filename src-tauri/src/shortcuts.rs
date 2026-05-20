use std::path::{Path, PathBuf};

use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    db,
    error::{AppError, AppResult, ErrorResponse},
    models::ShortcutRecord,
};

pub fn desktop_dir() -> AppResult<PathBuf> {
    dirs::desktop_dir().ok_or(AppError::DesktopNotFound)
}

pub fn unique_managed_path(dir: &Path, file_name: &str) -> PathBuf {
    let original = dir.join(file_name);
    if !original.exists() {
        return original;
    }

    let file_path = Path::new(file_name);
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let extension = file_path.extension().and_then(|value| value.to_str());

    for index in 1..=999 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    let uuid = Uuid::new_v4();
    let fallback_name = match extension {
        Some(extension) => format!("{stem} {uuid}.{extension}"),
        None => format!("{stem} {uuid}"),
    };
    dir.join(fallback_name)
}

#[tauri::command]
pub fn scan_desktop_shortcuts() -> Result<Vec<ShortcutRecord>, ErrorResponse> {
    scan_desktop_shortcuts_inner().map_err(Into::into)
}

#[tauri::command]
pub fn list_managed_shortcuts(
    state: State<'_, AppState>,
) -> Result<Vec<ShortcutRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_shortcuts(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn collect_shortcut(
    path: String,
    state: State<'_, AppState>,
) -> Result<ShortcutRecord, ErrorResponse> {
    collect_shortcut_inner(Path::new(&path), &state).map_err(Into::into)
}

#[tauri::command]
pub fn launch_shortcut(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    let shortcut = find_managed_shortcut(&state, &id).map_err(ErrorResponse::from)?;
    tauri_plugin_opener::open_path(&shortcut.managed_path, None::<&str>)
        .map_err(|error| ErrorResponse::from(AppError::File(error.to_string())))?;

    let opened_at = Utc::now().to_rfc3339();
    let conn = state
        .conn
        .lock()
        .map_err(|error| ErrorResponse::from(AppError::Database(error.to_string())))?;
    db::mark_shortcut_opened(&conn, &id, &opened_at)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn restore_shortcut(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    restore_shortcut_inner(&id, &state).map_err(Into::into)
}

fn restore_shortcut_inner(id: &str, state: &AppState) -> AppResult<()> {
    let shortcut = find_managed_shortcut(state, id)?;
    let original_path = Path::new(&shortcut.original_path);
    if original_path.exists() {
        return Err(AppError::RestoreConflict);
    }

    std::fs::rename(&shortcut.managed_path, &shortcut.original_path).map_err(AppError::from)?;

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    if let Err(delete_error) = db::delete_shortcut(&conn, id) {
        drop(conn);
        if let Err(rollback_error) =
            std::fs::rename(&shortcut.original_path, &shortcut.managed_path)
        {
            return Err(AppError::File(format!(
                "Failed to delete shortcut from database ({delete_error}) and failed to roll back restored file from original_path={} to managed_path={}: {rollback_error}",
                shortcut.original_path,
                shortcut.managed_path
            )));
        }
        return Err(AppError::from(delete_error));
    }

    Ok(())
}

fn scan_desktop_shortcuts_inner() -> AppResult<Vec<ShortcutRecord>> {
    let mut shortcuts = Vec::new();
    for entry in std::fs::read_dir(desktop_dir()?)? {
        let entry = entry?;
        let path = entry.path();
        if !is_lnk_file(&path) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let original_path = path.to_string_lossy().into_owned();
        shortcuts.push(ShortcutRecord {
            id: original_path.clone(),
            name,
            original_path,
            managed_path: String::new(),
            target_path: None,
            icon_path: None,
            last_opened_at: None,
            created_at: String::new(),
        });
    }

    shortcuts.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(shortcuts)
}

fn collect_shortcut_inner(path: &Path, state: &AppState) -> AppResult<ShortcutRecord> {
    if !is_lnk_file(path) {
        return Err(AppError::File(
            "Only .lnk files can be collected".to_string(),
        ));
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::File("Shortcut path has no file name".to_string()))?;
    let managed_path = unique_managed_path(&state.shortcuts_dir, file_name);

    std::fs::rename(path, &managed_path)?;

    let now = Utc::now().to_rfc3339();
    let shortcut = ShortcutRecord {
        id: managed_path.to_string_lossy().into_owned(),
        name: file_name.to_string(),
        original_path: path.to_string_lossy().into_owned(),
        managed_path: managed_path.to_string_lossy().into_owned(),
        target_path: None,
        icon_path: None,
        last_opened_at: None,
        created_at: now,
    };

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    if let Err(insert_error) = db::insert_shortcut(&conn, &shortcut) {
        drop(conn);
        if let Err(rollback_error) = std::fs::rename(&managed_path, path) {
            return Err(AppError::File(format!(
                "Failed to insert shortcut into database ({insert_error}) and failed to roll back moved file from managed_path={} to original_path={}: {rollback_error}",
                managed_path.display(),
                path.display()
            )));
        }
        return Err(AppError::from(insert_error));
    }

    Ok(shortcut)
}

fn find_managed_shortcut(state: &AppState, id: &str) -> AppResult<ShortcutRecord> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::find_shortcut(&conn, id)?
        .ok_or_else(|| AppError::Database("Shortcut was not found".to_string()))
}

fn is_lnk_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app_state::AppState, db};
    use rusqlite::Connection;
    use std::sync::Mutex;

    #[test]
    fn unique_managed_path_uses_original_name_then_numbered_suffix() {
        let temp_dir =
            std::env::temp_dir().join(format!("offline-desktop-manager-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let original = unique_managed_path(&temp_dir, "工具.lnk");
        assert_eq!(original, temp_dir.join("工具.lnk"));

        std::fs::write(&original, b"shortcut").expect("create existing shortcut");

        let numbered = unique_managed_path(&temp_dir, "工具.lnk");
        assert_eq!(numbered, temp_dir.join("工具 (1).lnk"));

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn collect_shortcut_rolls_back_file_move_when_db_insert_fails() {
        let temp_dir = test_dir();
        let original_dir = temp_dir.join("desktop");
        let shortcuts_dir = temp_dir.join("managed");
        std::fs::create_dir_all(&original_dir).expect("create desktop dir");
        std::fs::create_dir_all(&shortcuts_dir).expect("create shortcuts dir");
        let original_path = original_dir.join("工具.lnk");
        let managed_path = shortcuts_dir.join("工具.lnk");
        std::fs::write(&original_path, b"shortcut").expect("create shortcut");
        let state = AppState {
            conn: Mutex::new(Connection::open_in_memory().expect("open db without migrations")),
            data_dir: temp_dir.clone(),
            shortcuts_dir,
        };

        collect_shortcut_inner(&original_path, &state).expect_err("insert should fail");

        assert!(original_path.exists());
        assert!(!managed_path.exists());

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn restore_shortcut_rolls_back_file_move_when_db_delete_fails() {
        let temp_dir = test_dir();
        let original_dir = temp_dir.join("desktop");
        let shortcuts_dir = temp_dir.join("managed");
        std::fs::create_dir_all(&original_dir).expect("create desktop dir");
        std::fs::create_dir_all(&shortcuts_dir).expect("create shortcuts dir");
        let original_path = original_dir.join("工具.lnk");
        let managed_path = shortcuts_dir.join("工具.lnk");
        std::fs::write(&managed_path, b"shortcut").expect("create managed shortcut");

        let conn = Connection::open_in_memory().expect("open db");
        db::migrate(&conn).expect("run migrations");
        db::insert_shortcut(
            &conn,
            &ShortcutRecord {
                id: managed_path.to_string_lossy().into_owned(),
                name: "工具.lnk".to_string(),
                original_path: original_path.to_string_lossy().into_owned(),
                managed_path: managed_path.to_string_lossy().into_owned(),
                target_path: None,
                icon_path: None,
                last_opened_at: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .expect("insert shortcut");
        conn.execute_batch(
            "
            CREATE TRIGGER block_shortcut_delete
            BEFORE DELETE ON shortcuts
            BEGIN
                SELECT RAISE(FAIL, 'delete blocked');
            END;
            ",
        )
        .expect("create delete trigger");
        let state = AppState {
            conn: Mutex::new(conn),
            data_dir: temp_dir.clone(),
            shortcuts_dir,
        };

        restore_shortcut_inner(&managed_path.to_string_lossy(), &state).expect_err("delete fails");

        assert!(managed_path.exists());
        assert!(!original_path.exists());

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("offline-desktop-manager-{}", uuid::Uuid::new_v4()))
    }
}
