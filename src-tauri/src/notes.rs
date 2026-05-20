use chrono::Utc;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    db,
    error::{AppError, ErrorResponse},
    models::{NoteInput, NoteRecord, NoteUpdate},
    windows,
};

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_notes(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn create_note(
    input: NoteInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteRecord, ErrorResponse> {
    let note = NoteRecord {
        id: Uuid::new_v4().to_string(),
        title: default_if_blank(input.title, "新便签"),
        content: input.content,
        color: default_if_blank(input.color, "#fff4b8"),
        x: None,
        y: None,
        width: 320,
        height: 260,
        is_open: true,
        updated_at: Utc::now().to_rfc3339(),
    };

    {
        let conn = state
            .conn
            .lock()
            .map_err(|error| AppError::Database(error.to_string()))?;
        db::insert_note(&conn, &note).map_err(AppError::from)?;
    }

    windows::open_note_window(&app, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn update_note(
    input: NoteUpdate,
    state: State<'_, AppState>,
) -> Result<NoteRecord, ErrorResponse> {
    let note = NoteRecord {
        id: input.id,
        title: input.title,
        content: input.content,
        color: input.color,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        is_open: input.is_open,
        updated_at: Utc::now().to_rfc3339(),
    };

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::update_note(&conn, &note)
        .map_err(AppError::from)
        .map_err(ErrorResponse::from)?;

    Ok(note)
}

#[tauri::command]
pub fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::delete_note(&conn, &id)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn open_note(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), ErrorResponse> {
    let note = open_note_inner(&id, &state)?;
    windows::open_note_window(&app, &note)
}

fn open_note_inner(id: &str, state: &AppState) -> Result<NoteRecord, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let mut note = db::find_note(&conn, id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Database("Note was not found".to_string()))?;

    note.is_open = true;
    note.updated_at = Utc::now().to_rfc3339();
    db::update_note(&conn, &note).map_err(AppError::from)?;

    Ok(note)
}

fn default_if_blank(value: String, default: &str) -> String {
    if value.trim().is_empty() {
        default.to_string()
    } else {
        value
    }
}
