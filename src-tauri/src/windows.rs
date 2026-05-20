use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    error::{AppError, ErrorResponse},
    models::NoteRecord,
};

pub fn open_note_window(app: &AppHandle, note: &NoteRecord) -> Result<(), ErrorResponse> {
    let label = format!("note-{}", note.id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| ErrorResponse::from(AppError::Window(error.to_string())))?;
        return Ok(());
    }

    let url = WebviewUrl::App(format!("/note/{}", note.id).into());
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(&note.title)
        .inner_size(note.width as f64, note.height as f64)
        .resizable(true);

    if let (Some(x), Some(y)) = (note.x, note.y) {
        builder = builder.position(x as f64, y as f64);
    }

    builder
        .build()
        .map_err(|error| ErrorResponse::from(AppError::Window(error.to_string())))?;

    Ok(())
}
