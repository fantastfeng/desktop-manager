mod app_state;
mod db;
mod error;
mod models;

fn main() {
    let state = app_state::AppState::initialize().expect("initialize app state");

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
