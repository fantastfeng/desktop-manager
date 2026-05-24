import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8');
const mainRs = readFileSync('src-tauri/src/main.rs', 'utf8');

describe('Tauri 托盘收起唤醒', () => {
  it('启用 tray-icon feature 并注册托盘点击处理', () => {
    expect(cargoToml).toMatch(/features\s*=\s*\[[^\]]*"tray-icon"/s);
    expect(mainRs).toContain('TrayIconBuilder::with_id("desktop-manager")');
    expect(mainRs).toContain('.show_menu_on_left_click(false)');
    expect(mainRs).toContain('toggle_main_window');
  });

  it('右键菜单提供窗口控制、刷新、数据目录和退出入口', () => {
    expect(mainRs).toContain('Menu::with_items');
    expect(mainRs).toContain('TRAY_TOGGLE_WINDOW_ID');
    expect(mainRs).toContain('TRAY_ALWAYS_ON_TOP_ID');
    expect(mainRs).toContain('TRAY_LOCK_POSITION_ID');
    expect(mainRs).toContain('TRAY_REFRESH_ID');
    expect(mainRs).toContain('TRAY_OPEN_DATA_DIR_ID');
    expect(mainRs).toContain('TRAY_EXIT_ID');
    expect(mainRs).toContain('.on_menu_event');
  });

  it('托盘菜单事件会广播刷新、锁定位置和透明度变更', () => {
    expect(mainRs).toContain('TRAY_REFRESH_EVENT');
    expect(mainRs).toContain('TRAY_LOCK_POSITION_EVENT');
    expect(mainRs).toContain('TRAY_OPACITY_EVENT');
    expect(mainRs).toContain('set_always_on_top');
    expect(mainRs).toContain('tauri_plugin_opener::open_path');
    expect(mainRs).toContain('app.exit(0)');
  });
});
