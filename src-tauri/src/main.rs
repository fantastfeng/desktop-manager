#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app_state;
mod db;
mod desktop_items;
mod error;
mod icon_util;
mod models;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_TOGGLE_WINDOW_ID: &str = "tray-toggle-window";
const TRAY_ALWAYS_ON_TOP_ID: &str = "tray-always-on-top";
const TRAY_LOCK_POSITION_ID: &str = "tray-lock-position";
const TRAY_OPACITY_80_ID: &str = "tray-opacity-80";
const TRAY_OPACITY_60_ID: &str = "tray-opacity-60";
const TRAY_OPACITY_40_ID: &str = "tray-opacity-40";
const TRAY_OPACITY_RESET_ID: &str = "tray-opacity-reset";
const TRAY_REFRESH_ID: &str = "tray-refresh";
const TRAY_OPEN_DATA_DIR_ID: &str = "tray-open-data-dir";
const TRAY_EXIT_ID: &str = "tray-exit";
const TRAY_REFRESH_EVENT: &str = "desktop-manager://refresh";
const TRAY_LOCK_POSITION_EVENT: &str = "desktop-manager://lock-position";
const TRAY_OPACITY_EVENT: &str = "desktop-manager://set-opacity";
const DEFAULT_PANEL_OPACITY: f64 = 0.74;

fn main() {
    let state = app_state::AppState::initialize().expect("initialize app state");

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_items::list_desktop_categories,
            desktop_items::create_desktop_category,
            desktop_items::delete_desktop_category,
            desktop_items::reorder_desktop_categories,
            desktop_items::list_desktop_items,
            desktop_items::add_desktop_paths,
            desktop_items::delete_desktop_item,
            desktop_items::rename_desktop_item,
            desktop_items::move_desktop_item_to_category,
            desktop_items::update_desktop_category_color,
            desktop_items::open_desktop_item,
            desktop_items::reorder_desktop_items
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let toggle_window = MenuItem::with_id(
        app,
        TRAY_TOGGLE_WINDOW_ID,
        "显示/隐藏悬浮窗",
        true,
        None::<&str>,
    )?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        TRAY_ALWAYS_ON_TOP_ID,
        "置顶窗口",
        true,
        false,
        None::<&str>,
    )?;
    let lock_position = CheckMenuItem::with_id(
        app,
        TRAY_LOCK_POSITION_ID,
        "锁定位置",
        true,
        false,
        None::<&str>,
    )?;
    let opacity_80 = MenuItem::with_id(app, TRAY_OPACITY_80_ID, "80%", true, None::<&str>)?;
    let opacity_60 = MenuItem::with_id(app, TRAY_OPACITY_60_ID, "60%", true, None::<&str>)?;
    let opacity_40 = MenuItem::with_id(app, TRAY_OPACITY_40_ID, "40%", true, None::<&str>)?;
    let opacity_reset =
        MenuItem::with_id(app, TRAY_OPACITY_RESET_ID, "恢复默认", true, None::<&str>)?;
    let opacity_menu = Submenu::with_id_and_items(
        app,
        "tray-opacity",
        "透明度",
        true,
        &[&opacity_80, &opacity_60, &opacity_40, &opacity_reset],
    )?;
    let separator_before_refresh = PredefinedMenuItem::separator(app)?;
    let refresh = MenuItem::with_id(app, TRAY_REFRESH_ID, "刷新列表", true, None::<&str>)?;
    let open_data_dir_item = MenuItem::with_id(
        app,
        TRAY_OPEN_DATA_DIR_ID,
        "打开数据目录",
        true,
        None::<&str>,
    )?;
    let separator_before_exit = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, TRAY_EXIT_ID, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_window,
            &always_on_top,
            &lock_position,
            &opacity_menu,
            &separator_before_refresh,
            &refresh,
            &open_data_dir_item,
            &separator_before_exit,
            &exit,
        ],
    )?;
    let always_on_top_for_handler = always_on_top.clone();
    let lock_position_for_handler = lock_position.clone();

    let mut tray = TrayIconBuilder::with_id("desktop-manager")
        .tooltip("桌面收纳")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            TRAY_TOGGLE_WINDOW_ID => toggle_main_window(app),
            TRAY_ALWAYS_ON_TOP_ID => {
                let checked = always_on_top_for_handler.is_checked().unwrap_or(false);
                set_main_window_always_on_top(app, checked);
            }
            TRAY_LOCK_POSITION_ID => {
                let checked = lock_position_for_handler.is_checked().unwrap_or(false);
                let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_LOCK_POSITION_EVENT, checked);
            }
            TRAY_OPACITY_80_ID => emit_panel_opacity(app, 0.8),
            TRAY_OPACITY_60_ID => emit_panel_opacity(app, 0.6),
            TRAY_OPACITY_40_ID => emit_panel_opacity(app, 0.4),
            TRAY_OPACITY_RESET_ID => emit_panel_opacity(app, DEFAULT_PANEL_OPACITY),
            TRAY_REFRESH_ID => {
                let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_REFRESH_EVENT, ());
            }
            TRAY_OPEN_DATA_DIR_ID => open_data_dir(app),
            TRAY_EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn toggle_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn set_main_window_always_on_top<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    always_on_top: bool,
) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_always_on_top(always_on_top);
    }
}

fn emit_panel_opacity<R: tauri::Runtime>(app: &tauri::AppHandle<R>, opacity: f64) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_OPACITY_EVENT, opacity);
}

fn open_data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let data_dir = app.state::<app_state::AppState>().data_dir.clone();
    let _ = tauri_plugin_opener::open_path(data_dir, None::<&str>);
}
