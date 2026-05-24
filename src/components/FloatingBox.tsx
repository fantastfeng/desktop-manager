import { EyeOff, FileText, Folder, Plus, Search } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  addDesktopPaths,
  createDesktopCategory,
  deleteDesktopCategory,
  deleteDesktopItem,
  listDesktopCategories,
  listDesktopItems,
  moveDesktopItemToCategory,
  openDesktopItem,
  renameDesktopItem,
  reorderDesktopCategories,
  reorderDesktopItems,
  updateDesktopCategoryColor,
} from '../api';
import { hasTauriRuntime, useTauriDragDrop } from '../hooks';
import type {
  DesktopKind,
  DesktopCategoryRecord,
  DesktopItemRecord,
  SortDirection,
  SortKey,
} from '../types';
import { errorMessage, iconSrc, pathsFromDrop } from '../utils';

const CATEGORY_DRAG_MIME = 'application/x-desktop-category-id';
const CATEGORY_POINTER_DRAG_THRESHOLD = 4;
const TRAY_REFRESH_EVENT = 'desktop-manager://refresh';
const TRAY_LOCK_POSITION_EVENT = 'desktop-manager://lock-position';
const TRAY_OPACITY_EVENT = 'desktop-manager://set-opacity';
const DEFAULT_PANEL_OPACITY = 0.74;
const CONTEXT_MENU_MIN_WIDTH = 180;
const CATEGORY_MENU_MIN_WIDTH = 152;
const ITEM_MENU_ITEM_HEIGHT = 32;
const ITEM_MENU_FIXED_HEIGHT = 92;
const CATEGORY_MENU_HEIGHT = 52;
const MENU_SCREEN_MARGIN = 8;

type CategoryPointerDrag = {
  sourceId: string;
  startX: number;
  startY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  width: number;
  height: number;
  moved: boolean;
};

type ItemPointerDrag = {
  id: string;
  startX: number;
  startY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  width: number;
  height: number;
  moved: boolean;
};

type ItemDragOverlay = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type CreateCategoryForm = {
  name: string;
  kind: DesktopKind;
};

type RenameItemForm = {
  item: DesktopItemRecord;
  name: string;
};

type CategoryColorForm = {
  category: DesktopCategoryRecord;
  color: string;
};

type CategoryPosition = {
  left: number;
  top: number;
};

type CategoryDragOverlay = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type PendingCategoryAnimation = {
  positions: Map<string, CategoryPosition>;
  skipCategoryId?: string;
};

type FloatingContextMenu =
  | {
      type: 'item';
      item: DesktopItemRecord;
      x: number;
      y: number;
      moveTargetsExpanded: boolean;
    }
  | {
      type: 'category';
      category: DesktopCategoryRecord;
      x: number;
      y: number;
    };

const CATEGORY_KIND_OPTIONS: Array<{ kind: DesktopKind; label: string }> = [
  { kind: 'software', label: '软件' },
  { kind: 'file', label: '文件' },
  { kind: 'folder', label: '文件夹' },
];

const CATEGORY_COLOR_OPTIONS = ['#22c55e', '#2563eb', '#f97316', '#e11d48', '#7c3aed'];

function compareItems(
  left: DesktopItemRecord,
  right: DesktopItemRecord,
  key: SortKey,
  direction: SortDirection,
) {
  const modifier = direction === 'asc' ? 1 : -1;
  if (key === 'modified_at') {
    return (
      (Date.parse(left.modified_at ?? '') - Date.parse(right.modified_at ?? '')) * modifier
    );
  }
  return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }) * modifier;
}

function matchesSearch(item: DesktopItemRecord, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const displayName = displayItemName(item).toLocaleLowerCase();

  return (
    displayName.includes(normalizedQuery) ||
    item.name.toLocaleLowerCase().includes(normalizedQuery) ||
    item.path.toLocaleLowerCase().includes(normalizedQuery)
  );
}

function displayItemName(item: DesktopItemRecord) {
  if (item.kind !== 'software') return item.name;
  return item.name.replace(/\.(lnk|exe)$/i, '');
}

function softwareMoveTargets(
  categories: DesktopCategoryRecord[],
  item: DesktopItemRecord,
) {
  if (item.kind !== 'software') return [];
  return categories.filter(
    (category) => category.kind === 'software' && category.id !== item.category_id,
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, input, textarea, select, a, [role="dialog"], [role="menu"], [role="menuitem"]',
    ),
  );
}

function categoryIds(categories: DesktopCategoryRecord[]) {
  return categories.map((category) => category.id);
}

function sameCategoryIds(left: string[] | null | undefined, right: string[]) {
  if (!left || left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function hasDataTransferType(
  event: React.DragEvent<HTMLElement>,
  mimeType: string,
) {
  return Array.from(event.dataTransfer.types ?? []).includes(mimeType);
}

function categoryColorStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return undefined;
  const value = match[1];
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return {
    backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.58)`,
    color: '#0f172a',
  };
}

function orderCategories(
  categories: DesktopCategoryRecord[],
  orderedIds: string[] | null,
) {
  if (!orderedIds) return categories;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ordered = orderedIds.flatMap((id) => {
    const category = byId.get(id);
    return category ? [category] : [];
  });
  const orderedIdSet = new Set(ordered.map((category) => category.id));
  return [...ordered, ...categories.filter((category) => !orderedIdSet.has(category.id))];
}

function movedCategories(
  categories: DesktopCategoryRecord[],
  sourceCategoryId: string,
  targetCategoryId: string,
) {
  if (!sourceCategoryId || sourceCategoryId === targetCategoryId) return null;
  const next = [...categories];
  const from = next.findIndex((category) => category.id === sourceCategoryId);
  const to = next.findIndex((category) => category.id === targetCategoryId);
  if (from < 0 || to < 0) return null;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function movedItems(
  items: DesktopItemRecord[],
  sourceId: string,
  targetId: string,
) {
  if (!sourceId || sourceId === targetId) return null;
  const next = [...items];
  const from = next.findIndex((item) => item.id === sourceId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function orderItems(
  items: DesktopItemRecord[],
  orderedIds: string[] | null,
) {
  if (!orderedIds) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return ordered;
}

function itemIds(items: DesktopItemRecord[]) {
  return items.map((item) => item.id);
}

function orderedItemsFromIds(
  items: DesktopItemRecord[],
  orderedIds: string[] | null,
) {
  if (!orderedIds) return null;
  const ordered = orderItems(items, orderedIds);
  return ordered.length === items.length ? ordered : null;
}

export default function FloatingBox() {
  const [categories, setCategories] = useState<DesktopCategoryRecord[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState('software');
  const activeCategoryIdRef = useRef(activeCategoryId);
  const refreshVersionRef = useRef(0);
  const [items, setItems] = useState<DesktopItemRecord[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [draggingCategoryOverlay, setDraggingCategoryOverlay] =
    useState<CategoryDragOverlay | null>(null);
  const [previewCategoryIds, setPreviewCategoryIds] = useState<string[] | null>(null);
  const [isHtmlDragging, setIsHtmlDragging] = useState(false);
  const [createCategoryForm, setCreateCategoryForm] = useState<CreateCategoryForm | null>(null);
  const [renameItemForm, setRenameItemForm] = useState<RenameItemForm | null>(null);
  const [categoryColorForm, setCategoryColorForm] = useState<CategoryColorForm | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggingItemOverlay, setDraggingItemOverlay] = useState<ItemDragOverlay | null>(null);
  const [previewItemIds, setPreviewItemIds] = useState<string[] | null>(null);
  const itemPointerDrag = useRef<ItemPointerDrag | null>(null);
  const itemElementRefs = useRef(new Map<string, HTMLDivElement>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastPreviewItemIdsRef = useRef<string[] | null>(null);
  const categoryPointerDrag = useRef<CategoryPointerDrag | null>(null);
  const lastPreviewTargetRef = useRef<string | undefined>(undefined);
  const categoryButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const floatingBoxRef = useRef<HTMLElement | null>(null);
  const pendingCategoryAnimation = useRef<PendingCategoryAnimation | null>(null);
  const currentPreviewCategoryIds = useRef<string[] | null>(null);
  const categoryAnimationFrame = useRef<number | null>(null);
  const suppressNextCategoryClick = useRef(false);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const [dropStatus, setDropStatus] = useState('拖入快捷方式、文件或文件夹。');
  const [contextMenu, setContextMenu] = useState<FloatingContextMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPositionLocked, setIsPositionLocked] = useState(false);
  const [panelOpacity, setPanelOpacity] = useState(DEFAULT_PANEL_OPACITY);

  async function refreshCategories() {
    const next = await listDesktopCategories();
    setCategories(next);
    if (!next.some((category) => category.id === activeCategoryIdRef.current)) {
      setActiveCategoryId(next[0]?.id ?? 'software');
    }
  }

  async function refreshItems(categoryId?: string) {
    const targetId = categoryId ?? activeCategoryIdRef.current;
    const version = ++refreshVersionRef.current;
    const nextItems = await listDesktopItems(targetId);
    if (refreshVersionRef.current === version) {
      setItems(nextItems);
    }
  }

  async function refreshFromTray() {
    setError(null);
    await refreshCategories();
    await refreshItems();
    setDropStatus('列表已刷新。');
  }

  const handlePathsDrop = useCallback(
    async (paths: string[]) => {
      setError(null);
      if (paths.length === 0) {
        const message = '没有读取到可添加的路径。';
        setDropStatus(message);
        setError(message);
        return;
      }
      setDropStatus(`准备添加 ${paths.length} 项。`);
      try {
        const added = await addDesktopPaths(paths, activeCategoryIdRef.current);
        if (added.length > 0) {
          setActiveCategoryId(added[0].category_id);
          setItems(await listDesktopItems(added[0].category_id));
          setDropStatus(`已添加 ${added.length} 项。`);
        } else {
          await refreshItems();
          setDropStatus('没有新增项目，列表已刷新。');
        }
      } catch (err) {
        const message = `添加失败：${errorMessage(err)}`;
        setDropStatus(message);
        setError(message);
      }
    },
    [],
  );

  const isDraggingOver = useTauriDragDrop(handlePathsDrop, setDropStatus);

  useEffect(() => {
    activeCategoryIdRef.current = activeCategoryId;
  }, [activeCategoryId]);

  useEffect(() => {
    refreshCategories().catch((err) => setError(`加载分类失败：${errorMessage(err)}`));
  }, []);

  useEffect(() => {
    setSortKey('name');
    setSortDirection('asc');
    setSearchQuery('');
    refreshItems(activeCategoryId).catch((err) => setError(`加载内容失败：${errorMessage(err)}`));
  }, [activeCategoryId]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let cancelled = false;
    let unlisten: Array<() => void> = [];
    void Promise.all([
      listen(TRAY_REFRESH_EVENT, () => {
        void refreshFromTray().catch((err) =>
          setError(`刷新列表失败：${errorMessage(err)}`),
        );
      }),
      listen<boolean>(TRAY_LOCK_POSITION_EVENT, (event) => {
        const locked = Boolean(event.payload);
        setIsPositionLocked(locked);
        setDropStatus(locked ? '窗口位置已锁定。' : '窗口位置已解锁。');
      }),
      listen<number>(TRAY_OPACITY_EVENT, (event) => {
        const opacity = Number(event.payload);
        if (!Number.isFinite(opacity)) return;
        setPanelOpacity(Math.min(0.9, Math.max(0.35, opacity)));
      }),
    ])
      .then((listeners) => {
        if (cancelled) {
          listeners.forEach((fn) => fn());
          return;
        }
        unlisten = listeners;
      })
      .catch((err) => {
        setError(`托盘事件监听失败：${errorMessage(err)}`);
      });

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const activeCategory = categories.find((category) => category.id === activeCategoryId);
  const isSoftware = activeCategory?.kind === 'software';
  const sortedItems = useMemo(
    () =>
      isSoftware
        ? items
        : [...items].sort((left, right) => compareItems(left, right, sortKey, sortDirection)),
    [items, sortDirection, sortKey, isSoftware],
  );
  const orderedItems = useMemo(
    () => orderItems(sortedItems, previewItemIds),
    [sortedItems, previewItemIds],
  );
  const visibleItems = useMemo(
    () => orderedItems.filter((item) => matchesSearch(item, searchQuery)),
    [searchQuery, orderedItems],
  );
  const displayedCategories = useMemo(
    () => orderCategories(categories, previewCategoryIds),
    [categories, previewCategoryIds],
  );

  function setCategoryButtonRef(categoryId: string, element: HTMLButtonElement | null) {
    if (element) {
      categoryButtonRefs.current.set(categoryId, element);
      return;
    }
    categoryButtonRefs.current.delete(categoryId);
  }

  function snapshotCategoryPositions() {
    const positions = new Map<string, CategoryPosition>();
    for (const [categoryId, element] of categoryButtonRefs.current) {
      const rect = element.getBoundingClientRect();
      positions.set(categoryId, { left: rect.left, top: rect.top });
    }
    return positions;
  }

  function categoryIdFromElement(element: Element | null, sourceCategoryId: string) {
    const categoryId = element
      ?.closest<HTMLElement>('[data-category-id]')
      ?.dataset.categoryId;
    return categoryId && categoryId !== sourceCategoryId ? categoryId : undefined;
  }

  function categoryIdFromPoint(clientX: number, clientY: number, sourceCategoryId: string) {
    for (const element of document.elementsFromPoint?.(clientX, clientY) ?? []) {
      const categoryId = categoryIdFromElement(element, sourceCategoryId);
      if (categoryId) return categoryId;
    }

    const directCategoryId = categoryIdFromElement(
      document.elementFromPoint?.(clientX, clientY) ?? null,
      sourceCategoryId,
    );
    if (directCategoryId) return directCategoryId;

    for (const [categoryId, element] of categoryButtonRefs.current) {
      if (categoryId === sourceCategoryId) continue;
      const rect = element.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return categoryId;
      }
    }
    return undefined;
  }

  function clearCategoryAnimationStyles(skipCategoryId?: string) {
    for (const [categoryId, element] of categoryButtonRefs.current) {
      if (categoryId === skipCategoryId) continue;
      element.style.transition = '';
      element.style.transform = '';
    }
  }

  function queueCategoryAnimation(skipCategoryId?: string) {
    pendingCategoryAnimation.current = {
      positions: snapshotCategoryPositions(),
      skipCategoryId,
    };
  }

  function playCategoryReorderAnimation(
    previousPositions: Map<string, CategoryPosition>,
    skipCategoryId?: string,
  ) {
    if (categoryAnimationFrame.current !== null) {
      window.cancelAnimationFrame(categoryAnimationFrame.current);
      categoryAnimationFrame.current = null;
      clearCategoryAnimationStyles(skipCategoryId);
    }

    for (const [categoryId, element] of categoryButtonRefs.current) {
      if (categoryId === skipCategoryId) continue;
      const previous = previousPositions.get(categoryId);
      if (!previous) continue;
      const current = element.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
      element.style.transition = 'none';
      element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    }

    categoryAnimationFrame.current = window.requestAnimationFrame(() => {
      categoryAnimationFrame.current = null;
      for (const [categoryId, element] of categoryButtonRefs.current) {
        if (categoryId === skipCategoryId) continue;
        if (!element.style.transform) continue;
        element.style.transition = '';
        element.style.transform = '';
      }
    });
  }

  useLayoutEffect(() => {
    const pendingAnimation = pendingCategoryAnimation.current;
    if (!pendingAnimation) return;
    pendingCategoryAnimation.current = null;
    playCategoryReorderAnimation(
      pendingAnimation.positions,
      pendingAnimation.skipCategoryId,
    );
  }, [categories, previewCategoryIds]);

  useEffect(() => {
    return () => {
      if (categoryAnimationFrame.current !== null) {
        window.cancelAnimationFrame(categoryAnimationFrame.current);
      }
    };
  }, []);

  function setCategoryDragPreview(nextIds: string[] | null, sourceCategoryId?: string) {
    const currentIds = currentPreviewCategoryIds.current;
    const baseIds = categoryIds(categoriesRef.current);
    if (nextIds && sameCategoryIds(currentIds ?? baseIds, nextIds)) return;
    if (!nextIds && !currentIds) return;

    queueCategoryAnimation(sourceCategoryId);
    currentPreviewCategoryIds.current = nextIds;
    setPreviewCategoryIds(nextIds);
  }

  function previewCategoryMove(sourceCategoryId: string, targetCategoryId?: string) {
    if (!targetCategoryId || sourceCategoryId === targetCategoryId) {
      setCategoryDragPreview(null, sourceCategoryId);
      return;
    }
    const next = movedCategories(categoriesRef.current, sourceCategoryId, targetCategoryId);
    if (!next) {
      setCategoryDragPreview(null, sourceCategoryId);
      return;
    }
    setCategoryDragPreview(categoryIds(next), sourceCategoryId);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const paths = pathsFromDrop(event);
    if (paths.length === 0) {
      setDropStatus('HTML 拖入没有读取到路径，请从资源管理器拖入真实文件或快捷方式。');
      return;
    }
    await handlePathsDrop(paths);
  }

  function handleWindowDragStart(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (isPositionLocked) return;
    if (isInteractiveTarget(event.target)) return;
    if (contextMenu) return;
    if (draggedCategoryId) return;
    if (itemPointerDrag.current) return;
    getCurrentWindow().startDragging().catch((err) => {
      setError(`移动窗口失败：${errorMessage(err)}`);
    });
  }

  function handleHideWindow() {
    setContextMenu(null);
    getCurrentWindow().hide().catch((err) => {
      setError(`隐藏窗口失败：${errorMessage(err)}`);
    });
  }

  function handleCategoryDragStart(
    event: React.DragEvent<HTMLButtonElement>,
    categoryId: string,
  ) {
    event.stopPropagation();
    setDraggedCategoryId(categoryId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(CATEGORY_DRAG_MIME, categoryId);
    event.dataTransfer.setData('text/plain', categoryId);
  }

  function handleCategoryDragOver(
    event: React.DragEvent<HTMLButtonElement>,
    targetCategoryId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (draggedCategoryId) {
      previewCategoryMove(draggedCategoryId, targetCategoryId);
    }
  }

  function handleCategoryPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    categoryId: string,
  ) {
    if (event.button !== 0 && event.button !== undefined) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    categoryPointerDrag.current = {
      sourceId: categoryId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
  }

  function handleCategoryClick(
    event: React.MouseEvent<HTMLButtonElement>,
    categoryId: string,
  ) {
    if (suppressNextCategoryClick.current) {
      suppressNextCategoryClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setActiveCategoryId(categoryId);
  }

  function categoryOverlayFromPointer(
    drag: CategoryPointerDrag,
    clientX: number,
    clientY: number,
  ): CategoryDragOverlay {
    const containerRect = floatingBoxRef.current?.getBoundingClientRect();
    const containerLeft = containerRect?.left ?? 0;
    const containerTop = containerRect?.top ?? 0;
    return {
      id: drag.sourceId,
      left: clientX - containerLeft - drag.pointerOffsetX,
      top: clientY - containerTop - drag.pointerOffsetY,
      width: drag.width,
      height: drag.height,
    };
  }

  function handleItemContextMenu(
    event: React.MouseEvent<HTMLElement>,
    item: DesktopItemRecord,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const menuHeight = ITEM_MENU_FIXED_HEIGHT + softwareMoveTargets(categoriesRef.current, item).length * ITEM_MENU_ITEM_HEIGHT;
    setContextMenu({
      type: 'item',
      item,
      x: Math.max(0, Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_MIN_WIDTH)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - menuHeight - MENU_SCREEN_MARGIN)),
      moveTargetsExpanded: false,
    });
  }

  function handleCategoryContextMenu(
    event: React.MouseEvent<HTMLElement>,
    category: DesktopCategoryRecord,
  ) {
    event.preventDefault();
    event.stopPropagation();
    categoryPointerDrag.current = null;
    setDraggedCategoryId(null);
    setDraggingCategoryOverlay(null);
    setCategoryDragPreview(null, category.id);
    setContextMenu({
      type: 'category',
      category,
      x: Math.max(0, Math.min(event.clientX, window.innerWidth - CATEGORY_MENU_MIN_WIDTH)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - CATEGORY_MENU_HEIGHT - MENU_SCREEN_MARGIN)),
    });
  }

  function handleOpenItem(item: DesktopItemRecord) {
    setContextMenu(null);
    openDesktopItem(item.id);
  }

  function openRenameItemPanel(item: DesktopItemRecord) {
    setContextMenu(null);
    setError(null);
    setRenameItemForm({ item, name: displayItemName(item) });
  }

  function openCategoryColorPanel(category: DesktopCategoryRecord) {
    setContextMenu(null);
    setError(null);
    setCategoryColorForm({ category, color: category.color ?? CATEGORY_COLOR_OPTIONS[0] });
  }

  function toggleMoveTargetsPanel(item: DesktopItemRecord) {
    setContextMenu((current) => {
      if (!current || current.type !== 'item' || current.item.id !== item.id) {
        return current;
      }
      return { ...current, moveTargetsExpanded: !current.moveTargetsExpanded };
    });
  }

  async function handleRenameItemSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameItemForm) return;
    const name = renameItemForm.name.trim();
    if (!name) return;
    try {
      const renamed = await renameDesktopItem(renameItemForm.item.id, name);
      setItems((current) =>
        current.map((item) => (item.id === renamed.id ? renamed : item)),
      );
      setRenameItemForm(null);
      setDropStatus(`已重命名：${renamed.name}`);
    } catch (err) {
      setError(`重命名失败：${errorMessage(err)}`);
    }
  }

  async function saveCategoryColor(color: string | null) {
    if (!categoryColorForm) return;
    try {
      const nextCategories = await updateDesktopCategoryColor(
        categoryColorForm.category.id,
        color,
      );
      setCategories(nextCategories);
      setCategoryColorForm(null);
      setDropStatus(`已更新分类颜色：${categoryColorForm.category.name}`);
    } catch (err) {
      setError(`设置颜色失败：${errorMessage(err)}`);
    }
  }

  async function handleCategoryColorSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryColorForm) return;
    await saveCategoryColor(categoryColorForm.color);
  }

  async function handleDeleteItem(item: DesktopItemRecord) {
    setError(null);
    setContextMenu(null);
    try {
      await deleteDesktopItem(item.id);
      await refreshItems(item.category_id);
      setDropStatus(`已从窗口移除：${item.name}`);
    } catch (err) {
      setError(`删除失败：${errorMessage(err)}`);
    }
  }

  async function handleMoveItemToCategory(
    item: DesktopItemRecord,
    targetCategory: DesktopCategoryRecord,
  ) {
    setError(null);
    setContextMenu(null);
    try {
      const moved = await moveDesktopItemToCategory(item.id, targetCategory.id);
      setActiveCategoryId(targetCategory.id);
      await refreshItems(targetCategory.id);
      setDropStatus(`已将 ${displayItemName(moved)} 换到分页：${targetCategory.name}`);
    } catch (err) {
      setError(`换分页失败：${errorMessage(err)}`);
    }
  }

  async function handleDeleteCategory(category: DesktopCategoryRecord) {
    setError(null);
    setContextMenu(null);
    try {
      const nextCategories = await deleteDesktopCategory(category.id);
      setCategories(nextCategories);
      if (category.id === activeCategoryId) {
        setActiveCategoryId(nextCategories[0]?.id ?? 'software');
      }
      setDropStatus(`已删除分类：${category.name}`);
    } catch (err) {
      setError(`删除分类失败：${errorMessage(err)}`);
    }
  }

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.item-context-menu')
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    function handleDocumentPointerMove(event: PointerEvent) {
      const drag = categoryPointerDrag.current;
      if (!drag) return;

      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < CATEGORY_POINTER_DRAG_THRESHOLD) return;

      drag.moved = true;
      setDraggedCategoryId(drag.sourceId);
      setDraggingCategoryOverlay(categoryOverlayFromPointer(drag, event.clientX, event.clientY));
      const targetCategoryId = categoryIdFromPoint(
        event.clientX,
        event.clientY,
        drag.sourceId,
      );
      if (targetCategoryId) {
        lastPreviewTargetRef.current = targetCategoryId;
        previewCategoryMove(drag.sourceId, targetCategoryId);
      }
      event.preventDefault();
    }

    function handleDocumentPointerUp(event: PointerEvent) {
      const drag = categoryPointerDrag.current;
      if (!drag) return;

      categoryPointerDrag.current = null;
      setDraggedCategoryId(null);
      if (!drag.moved) return;

      suppressNextCategoryClick.current = true;
      window.setTimeout(() => {
        suppressNextCategoryClick.current = false;
      }, 0);
      event.preventDefault();

      const targetCategoryId =
        lastPreviewTargetRef.current ??
        categoryIdFromPoint(event.clientX, event.clientY, drag.sourceId);
      lastPreviewTargetRef.current = undefined;
      if (!targetCategoryId) {
        setDraggingCategoryOverlay(null);
        setCategoryDragPreview(null, drag.sourceId);
        return;
      }
      void moveCategory(drag.sourceId, targetCategoryId);
    }

    function handleDocumentPointerCancel() {
      categoryPointerDrag.current = null;
      lastPreviewTargetRef.current = undefined;
      setDraggedCategoryId(null);
      setDraggingCategoryOverlay(null);
      setCategoryDragPreview(null);
    }

    document.addEventListener('pointermove', handleDocumentPointerMove);
    document.addEventListener('pointerup', handleDocumentPointerUp);
    document.addEventListener('pointercancel', handleDocumentPointerCancel);
    return () => {
      document.removeEventListener('pointermove', handleDocumentPointerMove);
      document.removeEventListener('pointerup', handleDocumentPointerUp);
      document.removeEventListener('pointercancel', handleDocumentPointerCancel);
    };
  }, [categories]);

  function itemIdFromPoint(clientX: number, clientY: number, excludeId?: string) {
    for (const element of document.elementsFromPoint?.(clientX, clientY) ?? []) {
      const id = element.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
      if (id && id !== excludeId) return id;
    }
    return undefined;
  }

  function itemOverlayFromPointer(
    drag: ItemPointerDrag,
    clientX: number,
    clientY: number,
  ): ItemDragOverlay {
    const containerRect = floatingBoxRef.current?.getBoundingClientRect();
    const containerLeft = containerRect?.left ?? 0;
    const containerTop = containerRect?.top ?? 0;
    return {
      id: drag.id,
      left: clientX - containerLeft - drag.pointerOffsetX,
      top: clientY - containerTop - drag.pointerOffsetY,
      width: drag.width,
      height: drag.height,
    };
  }

  useEffect(() => {
    function handleItemPointerMove(event: PointerEvent) {
      const drag = itemPointerDrag.current;
      if (!drag) return;

      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < CATEGORY_POINTER_DRAG_THRESHOLD) return;

      drag.moved = true;
      setDraggedItemId(drag.id);
      setDraggingItemOverlay(itemOverlayFromPointer(drag, event.clientX, event.clientY));

      const targetId = itemIdFromPoint(event.clientX, event.clientY, drag.id);
      if (targetId && targetId !== drag.id) {
        const next = movedItems(itemsRef.current, drag.id, targetId);
        if (next) {
          const nextIds = itemIds(next);
          lastPreviewItemIdsRef.current = nextIds;
          setPreviewItemIds(nextIds);
        }
      }
      event.preventDefault();
    }

    function handleItemPointerUp(event: PointerEvent) {
      const drag = itemPointerDrag.current;
      if (!drag) return;

      itemPointerDrag.current = null;
      setDraggedItemId(null);
      setDraggingItemOverlay(null);
      if (!drag.moved) {
        setPreviewItemIds(null);
        return;
      }
      event.preventDefault();

      const targetId = itemIdFromPoint(event.clientX, event.clientY, drag.id);
      const next =
        (targetId ? movedItems(itemsRef.current, drag.id, targetId) : null) ??
        orderedItemsFromIds(itemsRef.current, lastPreviewItemIdsRef.current);
      if (!next) {
        lastPreviewItemIdsRef.current = null;
        setPreviewItemIds(null);
        return;
      }
      setItems(next);
      lastPreviewItemIdsRef.current = null;
      setPreviewItemIds(null);

      void (async () => {
        try {
          await reorderDesktopItems(activeCategoryId, itemIds(next));
        } catch (err) {
          setError(`调整顺序失败：${errorMessage(err)}`);
          await refreshItems();
        }
      })();
    }

    function handleItemPointerCancel() {
      itemPointerDrag.current = null;
      lastPreviewItemIdsRef.current = null;
      setDraggedItemId(null);
      setDraggingItemOverlay(null);
      setPreviewItemIds(null);
    }

    document.addEventListener('pointermove', handleItemPointerMove);
    document.addEventListener('pointerup', handleItemPointerUp);
    document.addEventListener('pointercancel', handleItemPointerCancel);
    return () => {
      document.removeEventListener('pointermove', handleItemPointerMove);
      document.removeEventListener('pointerup', handleItemPointerUp);
      document.removeEventListener('pointercancel', handleItemPointerCancel);
    };
  }, [activeCategoryId]);

  function openCreateCategoryPanel() {
    setError(null);
    setCreateCategoryForm({ name: '', kind: 'software' });
  }

  function closeCreateCategoryPanel() {
    setCreateCategoryForm(null);
  }

  async function handleCreateCategorySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createCategoryForm) return;
    const name = createCategoryForm.name.trim();
    if (!name) return;
    try {
      const category = await createDesktopCategory(name, createCategoryForm.kind);
      await refreshCategories();
      setActiveCategoryId(category.id);
      setCreateCategoryForm(null);
    } catch (err) {
      setError(`新建分类失败：${errorMessage(err)}`);
    }
  }

  async function moveCategory(sourceCategoryId: string, targetCategoryId: string) {
    setDraggedCategoryId(null);
    setDraggingCategoryOverlay(null);
    currentPreviewCategoryIds.current = null;
    setPreviewCategoryIds(null);
    setIsHtmlDragging(false);
    const next = movedCategories(categoriesRef.current, sourceCategoryId, targetCategoryId);
    if (!next) return;
    queueCategoryAnimation();
    setCategories(next);
    try {
      await reorderDesktopCategories(next.map((category) => category.id));
    } catch (err) {
      setError(`调整分类顺序失败：${errorMessage(err)}`);
    }
  }

  async function handleCategoryDrop(
    event: React.DragEvent<HTMLButtonElement>,
    targetCategoryId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const sourceCategoryId =
      event.dataTransfer.getData(CATEGORY_DRAG_MIME) ||
      event.dataTransfer.getData('text/plain') ||
      draggedCategoryId;

    if (!sourceCategoryId) {
      setDraggedCategoryId(null);
      setDraggingCategoryOverlay(null);
      setCategoryDragPreview(null);
      setIsHtmlDragging(false);
      return;
    }
    await moveCategory(sourceCategoryId, targetCategoryId);
  }

  return (
    <section
      ref={floatingBoxRef}
      className={`floating-box ${isDraggingOver || isHtmlDragging ? 'dragging-over' : ''}`}
      data-testid="desktop-drop-zone"
      style={{ '--floating-box-opacity': panelOpacity } as CSSProperties}
      onMouseDown={handleWindowDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        setIsHtmlDragging(true);
      }}
      onDragLeave={() => setIsHtmlDragging(false)}
      onDrop={(event) => {
        setIsHtmlDragging(false);
        handleDrop(event);
      }}
    >
      <div
        className="floating-drag-region"
        data-tauri-drag-region
        data-testid="window-drag-region"
      >
        <span>桌面收纳</span>
        <button
          className="window-hide-button"
          type="button"
          aria-label="隐藏窗口"
          title="隐藏窗口"
          onClick={handleHideWindow}
        >
          <EyeOff size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="category-strip" aria-label="分类">
        {displayedCategories.map((category) => {
          const isDragPlaceholder = draggingCategoryOverlay?.id === category.id;
          return (
            <button
              key={category.id}
              className={[
                'category-pill',
                category.id === activeCategoryId ? 'active' : '',
                category.id === draggedCategoryId && !isDragPlaceholder ? 'dragging' : '',
                isDragPlaceholder ? 'drag-placeholder' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              data-category-id={category.id}
              style={categoryColorStyle(category.color)}
              ref={(element) => setCategoryButtonRef(category.id, element)}
              onDragStart={(event) => handleCategoryDragStart(event, category.id)}
              onDragEnd={() => {
                setDraggedCategoryId(null);
                setDraggingCategoryOverlay(null);
                setCategoryDragPreview(null, category.id);
              }}
              onDragOver={(event) => {
                if (
                  draggedCategoryId ||
                  hasDataTransferType(event, CATEGORY_DRAG_MIME)
                ) {
                  handleCategoryDragOver(event, category.id);
                }
              }}
              onDrop={(event) => {
                if (
                  draggedCategoryId ||
                  hasDataTransferType(event, CATEGORY_DRAG_MIME)
                ) {
                  handleCategoryDrop(event, category.id);
                }
              }}
              onPointerDown={(event) => handleCategoryPointerDown(event, category.id)}
              onContextMenu={(event) => handleCategoryContextMenu(event, category)}
              onClick={(event) => handleCategoryClick(event, category.id)}
            >
              {category.name}
            </button>
          );
        })}
        <button
          className="category-add"
          type="button"
          aria-label="新增分类"
          title="新增分类"
          onClick={openCreateCategoryPanel}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>

      {draggingCategoryOverlay ? (
        <button
          className={[
            'category-drag-overlay',
            draggingCategoryOverlay.id === activeCategoryId ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="category-drag-overlay"
          style={{
            left: `${draggingCategoryOverlay.left}px`,
            top: `${draggingCategoryOverlay.top}px`,
            width: `${draggingCategoryOverlay.width}px`,
            height: `${draggingCategoryOverlay.height}px`,
          }}
        >
          {categories.find((category) => category.id === draggingCategoryOverlay.id)?.name ?? ''}
        </button>
      ) : null}

      {draggingItemOverlay && isSoftware ? (
        <div
          className="software-drag-overlay"
          aria-hidden="true"
          style={{
            left: `${draggingItemOverlay.left}px`,
            top: `${draggingItemOverlay.top}px`,
            width: `${draggingItemOverlay.width}px`,
            height: `${draggingItemOverlay.height}px`,
          }}
        >
          {(() => {
            const dragItem = items.find((i) => i.id === draggingItemOverlay.id);
            if (!dragItem) return null;
            const src = iconSrc(dragItem.icon_path);
            return (
              <>
                {src ? (
                  <img src={src} alt="" />
                ) : (
                  <FileText size={24} aria-hidden="true" />
                )}
                <span>{displayItemName(dragItem)}</span>
              </>
            );
          })()}
        </div>
      ) : null}

      {createCategoryForm ? (
        <form
          className="create-category-panel"
          role="dialog"
          aria-labelledby="create-category-title"
          onSubmit={handleCreateCategorySubmit}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="create-category-header">
            <strong id="create-category-title">新建分类</strong>
          </div>
          <label className="create-category-name">
            <span>分类名称</span>
            <input
              aria-label="分类名称"
              value={createCategoryForm.name}
              autoFocus
              onChange={(event) =>
                setCreateCategoryForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
          </label>
          <div className="create-category-types" role="group" aria-label="分类类型">
            {CATEGORY_KIND_OPTIONS.map((option) => (
              <button
                key={option.kind}
                className={
                  createCategoryForm.kind === option.kind
                    ? 'create-category-type selected'
                    : 'create-category-type'
                }
                type="button"
                aria-pressed={createCategoryForm.kind === option.kind}
                onClick={() =>
                  setCreateCategoryForm((current) =>
                    current ? { ...current, kind: option.kind } : current,
                  )
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="create-category-actions">
            <button type="button" className="create-category-cancel" onClick={closeCreateCategoryPanel}>
              取消
            </button>
            <button
              type="submit"
              className="create-category-submit"
              disabled={!createCategoryForm.name.trim()}
            >
              创建
            </button>
          </div>
        </form>
      ) : null}

      {renameItemForm ? (
        <form
          className="create-category-panel"
          role="dialog"
          aria-labelledby="rename-item-title"
          onSubmit={handleRenameItemSubmit}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="create-category-header">
            <strong id="rename-item-title">重命名</strong>
          </div>
          <label className="create-category-name">
            <span>名称</span>
            <input
              aria-label="名称"
              value={renameItemForm.name}
              autoFocus
              onChange={(event) =>
                setRenameItemForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
          </label>
          <div className="create-category-actions">
            <button
              type="button"
              className="create-category-cancel"
              onClick={() => setRenameItemForm(null)}
            >
              取消
            </button>
            <button
              type="submit"
              className="create-category-submit"
              disabled={!renameItemForm.name.trim()}
            >
              保存
            </button>
          </div>
        </form>
      ) : null}

      {categoryColorForm ? (
        <form
          className="create-category-panel"
          role="dialog"
          aria-labelledby="category-color-title"
          onSubmit={handleCategoryColorSubmit}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="create-category-header">
            <strong id="category-color-title">设置分类颜色</strong>
          </div>
          <div className="category-color-swatches" role="group" aria-label="预设颜色">
            {CATEGORY_COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                className="category-color-swatch"
                type="button"
                aria-label={color}
                aria-pressed={categoryColorForm.color === color}
                style={{ backgroundColor: categoryColorStyle(color)?.backgroundColor }}
                onClick={() =>
                  setCategoryColorForm((current) =>
                    current ? { ...current, color } : current,
                  )
                }
              />
            ))}
          </div>
          <label className="category-color-custom">
            <span>自定义颜色</span>
            <input
              aria-label="自定义颜色"
              type="color"
              value={categoryColorForm.color}
              onChange={(event) =>
                setCategoryColorForm((current) =>
                  current ? { ...current, color: event.target.value } : current,
                )
              }
            />
          </label>
          <div className="create-category-actions">
            <button
              type="button"
              className="create-category-cancel"
              onClick={() => setCategoryColorForm(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="create-category-cancel"
              onClick={() => void saveCategoryColor(null)}
            >
              默认
            </button>
            <button type="submit" className="create-category-submit">
              保存
            </button>
          </div>
        </form>
      ) : null}

      <label className="search-box">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="搜索"
          type="search"
          placeholder="搜索名称或路径"
          value={searchQuery}
          onChange={(event) => {
            setContextMenu(null);
            setSearchQuery(event.target.value);
          }}
        />
      </label>
      <p className="drop-status" data-testid="drop-status">
        {dropStatus}
      </p>

      {error ? <p className="error-message">{error}</p> : null}

      {isSoftware ? (
        <>
          <div className="software-grid" aria-label={activeCategory?.name ?? '软件'}>
            {visibleItems.map((item) => {
              const src = iconSrc(item.icon_path);
              const displayName = displayItemName(item);
              return (
                <div
                  className={[
                    'software-item',
                    draggedItemId === item.id ? 'software-item-dragging' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-item-id={item.id}
                  key={item.id}
                  ref={(element) => {
                    if (element) {
                      itemElementRefs.current.set(item.id, element);
                    } else {
                      itemElementRefs.current.delete(item.id);
                    }
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    lastPreviewItemIdsRef.current = null;
                    itemPointerDrag.current = {
                      id: item.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      pointerOffsetX: event.clientX - rect.left,
                      pointerOffsetY: event.clientY - rect.top,
                      width: rect.width,
                      height: rect.height,
                      moved: false,
                    };
                  }}
                  onContextMenu={(event) => handleItemContextMenu(event, item)}
                >
                  <button
                    className="software-open"
                    type="button"
                    onClick={() => handleOpenItem(item)}
                  >
                    {src ? (
                      <img src={src} alt="" />
                    ) : (
                      <FileText size={24} aria-hidden="true" />
                    )}
                    <span>{displayName}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="details-list">
          <div className="details-header">
            <button type="button" onClick={() => toggleSort('name')}>
              文件名
            </button>
            <button type="button" onClick={() => toggleSort('modified_at')}>
              修改时间
            </button>
          </div>
          {visibleItems.map((item) => {
            const displayName = displayItemName(item);
            return (
              <div
                className="details-row"
                data-testid="desktop-detail-row"
                key={item.id}
                onContextMenu={(event) => handleItemContextMenu(event, item)}
              >
                <button
                  className="details-open"
                  type="button"
                  onClick={() => handleOpenItem(item)}
                >
                  <span>
                    {item.kind === 'folder' ? (
                      <Folder size={15} aria-hidden="true" />
                    ) : (
                      <FileText size={15} aria-hidden="true" />
                    )}
                    {displayName}
                  </span>
                  <time>
                    {item.modified_at ? new Date(item.modified_at).toLocaleString() : '-'}
                  </time>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {contextMenu ? (
        <div
          className="item-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.type === 'item' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleOpenItem(contextMenu.item)}
              >
                打开 {displayItemName(contextMenu.item)}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => openRenameItemPanel(contextMenu.item)}
              >
                重命名
              </button>
              {(() => {
                const moveTargets = softwareMoveTargets(categories, contextMenu.item);
                if (moveTargets.length === 0) return null;
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      aria-expanded={contextMenu.moveTargetsExpanded}
                      onClick={() => toggleMoveTargetsPanel(contextMenu.item)}
                    >
                      换分页
                    </button>
                    {contextMenu.moveTargetsExpanded ? (
                      <div
                        className="item-context-submenu"
                        role="group"
                        aria-label="可换分页"
                      >
                        {moveTargets.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            role="menuitem"
                            onClick={() => handleMoveItemToCategory(contextMenu.item, category)}
                          >
                            {category.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                );
              })()}
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => handleDeleteItem(contextMenu.item)}
              >
                移除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => openCategoryColorPanel(contextMenu.category)}
              >
                设置颜色 {contextMenu.category.name}
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => handleDeleteCategory(contextMenu.category)}
              >
                删除分类 {contextMenu.category.name}
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
