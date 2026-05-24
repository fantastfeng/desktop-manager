import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tauriMain = readFileSync('src-tauri/src/main.rs', 'utf8');
const desktopItems = readFileSync('src-tauri/src/desktop_items.rs', 'utf8');

describe('Tauri Windows 入口', () => {
  it('Windows 启动时不显示 cmd 控制台窗口', () => {
    expect(tauriMain).toContain(
      '#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]',
    );
  });

  it('提取快捷方式图标时隐藏 PowerShell 子进程窗口', () => {
    expect(desktopItems).toContain('std::os::windows::process::CommandExt');
    expect(desktopItems).toContain('const CREATE_NO_WINDOW: u32 = 0x08000000;');
    expect(desktopItems).toContain('.creation_flags(CREATE_NO_WINDOW)');
  });
});
