import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState } from 'react';

function statusError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function hasTauriRuntime() {
  return (
    isTauri() ||
    '__TAURI_INTERNALS__' in globalThis ||
    '__TAURI_INTERNALS__' in window
  );
}

export function useTauriDragDrop(
  onDrop: (paths: string[]) => void,
  onStatus?: (message: string) => void,
) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const onDropRef = useRef(onDrop);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const emitStatus = (message: string) => onStatusRef.current?.(message);

    if (!hasTauriRuntime()) {
      emitStatus('浏览器预览模式，等待 HTML 拖入。');
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDraggingOver(true);
          emitStatus('拖拽进入窗口。');
          return;
        }
        if (payload.type === 'leave') {
          setIsDraggingOver(false);
          emitStatus('拖拽已离开窗口。');
          return;
        }
        if (payload.type === 'drop') {
          const paths = payload.paths ?? [];
          setIsDraggingOver(false);
          emitStatus(paths.length > 0 ? `收到 ${paths.length} 个路径。` : '收到拖拽，但没有读取到路径。');
          Promise.resolve(onDropRef.current(paths)).catch((error: unknown) => {
            emitStatus(`拖拽处理失败：${statusError(error)}`);
          });
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        emitStatus('拖拽监听已就绪。');
      })
      .catch((error) => {
        emitStatus(`拖拽监听注册失败：${statusError(error)}`);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return isDraggingOver;
}
