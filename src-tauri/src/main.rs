mod app_state;
mod db;
mod error;
mod models;
mod notes;
mod shortcuts;
mod windows;

fn main() {
    let state = app_state::AppState::initialize().expect("initialize app state");

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            shortcuts::scan_desktop_shortcuts,
            shortcuts::list_managed_shortcuts,
            shortcuts::collect_shortcut,
            shortcuts::launch_shortcut,
            shortcuts::restore_shortcut,
            notes::list_notes,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::open_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
