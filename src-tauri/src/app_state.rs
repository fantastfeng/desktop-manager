#![allow(dead_code)]

use std::{path::PathBuf, sync::Mutex};

use rusqlite::Connection;

use crate::{
    db,
    error::{AppError, AppResult},
};

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub icons_dir: PathBuf,
}

impl AppState {
    pub fn initialize() -> AppResult<Self> {
        let data_dir = dirs::data_local_dir()
            .ok_or(AppError::DataDirUnavailable)?
            .join("OfflineDesktopManager");
        let preferred_icons_dir = data_dir.join("Icons");

        std::fs::create_dir_all(&data_dir)?;
        let icons_dir = writable_icons_dir(preferred_icons_dir)?;

        let conn = Connection::open(data_dir.join("data.db"))?;
        db::migrate(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            data_dir,
            icons_dir,
        })
    }
}

fn writable_icons_dir(preferred: PathBuf) -> AppResult<PathBuf> {
    if directory_is_writable(&preferred) {
        return Ok(preferred);
    }

    let fallback = std::env::temp_dir()
        .join("OfflineDesktopManager")
        .join("Icons");
    std::fs::create_dir_all(&fallback)?;
    Ok(fallback)
}

fn directory_is_writable(dir: &PathBuf) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }

    let probe = dir.join(format!(".write-test-{}", uuid::Uuid::new_v4()));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}
