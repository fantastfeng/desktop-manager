import { describe, expect, it } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';

describe('Tauri 主窗口配置', () => {
  it('使用一个透明、无边框、小尺寸主窗口', () => {
    const windows = tauriConfig.app.windows;

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      label: 'main',
      transparent: true,
      decorations: false,
      resizable: true,
      width: 360,
      height: 460,
      minWidth: 300,
      minHeight: 360,
      dragDropEnabled: true,
    });
  });

  it('主窗口 capability 放行 Tauri 事件监听', () => {
    expect(capability.windows).toContain('main');
    expect(capability.permissions).toEqual(
      expect.arrayContaining([expect.stringMatching(/^core:(default|event:(default|allow-listen))$/)]),
    );
  });

  it('主窗口 capability 放行窗口拖动命令', () => {
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });

  it('主窗口 capability 放行隐藏窗口命令', () => {
    expect(capability.permissions).toContain('core:window:allow-hide');
  });
});
