import { describe, expect, it } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';

describe('Tauri main window config', () => {
  it('uses one transparent frameless compact main window with native file drop enabled', () => {
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

  it('allows the main window to subscribe and unsubscribe native drag-drop events', () => {
    expect(capability.windows).toContain('main');
    expect(capability.permissions).toEqual(
      expect.arrayContaining(['core:event:allow-listen', 'core:event:allow-unlisten']),
    );
  });

  it('allows the main window to start OS window dragging', () => {
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });

  it('allows the main window to hide itself', () => {
    expect(capability.permissions).toContain('core:window:allow-hide');
  });

  it('builds a Windows NSIS installer with offline WebView2 runtime installation', () => {
    expect(tauriConfig.bundle).toMatchObject({
      active: true,
      targets: ['nsis'],
      windows: {
        webviewInstallMode: {
          type: 'offlineInstaller',
          silent: true,
        },
      },
    });
  });
});
