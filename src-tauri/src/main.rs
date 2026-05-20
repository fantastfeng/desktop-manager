mod app_state;
mod db;
mod error;
mod models;
mod shortcuts;

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
            shortcuts::restore_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
