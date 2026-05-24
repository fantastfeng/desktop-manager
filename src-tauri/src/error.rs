#![allow(dead_code)]

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Desktop folder was not found")]
    DesktopNotFound,
    #[error("Application data directory is unavailable")]
    DataDirUnavailable,
    #[error("File error: {0}")]
    File(String),
    #[error("Database error: {0}")]
    Database(String),
    #[error("{0} was not found")]
    NotFound(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    pub message: String,
}

impl From<AppError> for ErrorResponse {
    fn from(error: AppError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::File(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
