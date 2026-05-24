export type DesktopKind = 'software' | 'file' | 'folder';

export interface DesktopCategoryRecord {
  id: string;
  name: string;
  kind: DesktopKind;
  sort_order: number;
  color: string | null;
  created_at: string;
}

export interface DesktopItemRecord {
  id: string;
  category_id: string;
  name: string;
  path: string;
  kind: DesktopKind;
  modified_at: string | null;
  icon_path: string | null;
  sort_order: number;
  created_at: string;
}

export type SortKey = 'name' | 'modified_at';
export type SortDirection = 'asc' | 'desc';
