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
    pub shortcuts_dir: PathBuf,
}

impl AppState {
    pub fn initialize() -> AppResult<Self> {
        let data_dir = dirs::data_local_dir()
            .ok_or(AppError::DataDirUnavailable)?
            .join("OfflineDesktopManager");
        let shortcuts_dir = data_dir.join("Shortcuts");

        std::fs::create_dir_all(&shortcuts_dir)?;

        let conn = Connection::open(data_dir.join("data.db"))?;
        db::migrate(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            data_dir,
            shortcuts_dir,
        })
    }
}
