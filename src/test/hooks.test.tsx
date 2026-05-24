import { renderHook, waitFor } from '@testing-library/react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTauriDragDrop } from '../hooks';

const isTauriMock = vi.mocked(isTauri);
const getCurrentWebviewMock = vi.mocked(getCurrentWebview);

describe('useTauriDragDrop', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    getCurrentWebviewMock.mockReset();
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('在 Tauri 环境中通过 WebView 原生拖拽事件读取路径', async () => {
    const onDrop = vi.fn(async () => undefined);
    let dragHandler:
      | ((event: { payload: { type: string; paths?: string[] } }) => void)
      | undefined;
    const onDragDropEvent = vi.fn(async (handler) => {
      dragHandler = handler;
      return () => undefined;
    });
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);

    renderHook(() => useTauriDragDrop(onDrop));

    await waitFor(() => {
      expect(onDragDropEvent).toHaveBeenCalled();
    });

    dragHandler?.({
      payload: {
        type: 'drop',
        paths: ['C:\\Users\\Example\\Desktop\\App.lnk'],
      },
    });

    expect(onDrop).toHaveBeenCalledWith(['C:\\Users\\Example\\Desktop\\App.lnk']);
  });

  it('在 isTauri 标记缺失但 Tauri internals 存在时仍注册拖拽监听', async () => {
    const onDrop = vi.fn();
    const onDragDropEvent = vi.fn(async () => () => undefined);
    isTauriMock.mockReturnValue(false);
    (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);

    renderHook(() => useTauriDragDrop(onDrop));

    await waitFor(() => {
      expect(onDragDropEvent).toHaveBeenCalled();
    });
  });
});
