import { invoke } from '@tauri-apps/api/core';
import type { DesktopCategoryRecord, DesktopItemRecord, DesktopKind } from './types';

export function listDesktopCategories() {
  return invoke<DesktopCategoryRecord[]>('list_desktop_categories');
}

export function createDesktopCategory(name: string, kind: DesktopKind) {
  return invoke<DesktopCategoryRecord>('create_desktop_category', { name, kind });
}

export function deleteDesktopCategory(id: string) {
  return invoke<DesktopCategoryRecord[]>('delete_desktop_category', { id });
}

export function reorderDesktopCategories(orderedIds: string[]) {
  return invoke<DesktopCategoryRecord[]>('reorder_desktop_categories', { orderedIds });
}

export function listDesktopItems(categoryId: string) {
  return invoke<DesktopItemRecord[]>('list_desktop_items', { categoryId });
}

export function addDesktopPaths(paths: string[], targetCategoryId: string) {
  return invoke<DesktopItemRecord[]>('add_desktop_paths', { paths, targetCategoryId });
}

export function deleteDesktopItem(id: string) {
  return invoke<void>('delete_desktop_item', { id });
}

export function renameDesktopItem(id: string, name: string) {
  return invoke<DesktopItemRecord>('rename_desktop_item', { id, name });
}

export function moveDesktopItemToCategory(id: string, targetCategoryId: string) {
  return invoke<DesktopItemRecord>('move_desktop_item_to_category', {
    id,
    targetCategoryId,
  });
}

export function updateDesktopCategoryColor(id: string, color: string | null) {
  return invoke<DesktopCategoryRecord[]>('update_desktop_category_color', { id, color });
}

export function openDesktopItem(id: string) {
  return invoke<void>('open_desktop_item', { id });
}

export function reorderDesktopItems(categoryId: string, orderedIds: string[]) {
  return invoke<void>('reorder_desktop_items', { categoryId, orderedIds });
}
