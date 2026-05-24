import { convertFileSrc } from '@tauri-apps/api/core';

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function iconSrc(iconPath: string | null) {
  return iconPath ? convertFileSrc(iconPath) : null;
}

export function pathsFromDrop(event: React.DragEvent<HTMLElement>) {
  const files = event.dataTransfer?.files;
  if (!files) return [];
  return Array.from(files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
}
