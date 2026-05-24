import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);
const getCurrentWebviewMock = vi.mocked(getCurrentWebview);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);

const categories = [
  {
    id: 'software',
    name: '软件',
    kind: 'software',
    sort_order: 0,
    color: null,
    created_at: '2026-05-21T00:00:00Z',
  },
  {
    id: 'files',
    name: '文件',
    kind: 'file',
    sort_order: 1,
    color: null,
    created_at: '2026-05-21T00:00:00Z',
  },
  {
    id: 'folders',
    name: '文件夹',
    kind: 'folder',
    sort_order: 2,
    color: null,
    created_at: '2026-05-21T00:00:00Z',
  },
];

const softwareItems = [
  {
    id: 'C:\\Apps\\Code.lnk',
    category_id: 'software',
    name: 'Code.lnk',
    path: 'C:\\Apps\\Code.lnk',
    kind: 'software',
    modified_at: null,
    icon_path: 'C:\\Icons\\code.png',
    created_at: '2026-05-21T00:00:00Z',
  },
  {
    id: 'C:\\Tools\\Notepad.lnk',
    category_id: 'software',
    name: 'Notepad.exe',
    path: 'C:\\Tools\\Notepad.lnk',
    kind: 'software',
    modified_at: null,
    icon_path: null,
    created_at: '2026-05-21T00:00:00Z',
  },
];

const fileItems = [
  {
    id: 'C:\\Docs\\方案.docx',
    category_id: 'files',
    name: '方案.docx',
    path: 'C:\\Docs\\方案.docx',
    kind: 'file',
    modified_at: '2026-05-21T08:00:00Z',
    icon_path: null,
    created_at: '2026-05-21T00:00:00Z',
  },
];

const addedItems = [
  {
    id: 'C:\\Docs\\新文件.pdf',
    category_id: 'files',
    name: '新文件.pdf',
    path: 'C:\\Docs\\新文件.pdf',
    kind: 'file',
    modified_at: '2026-05-21T09:00:00Z',
    icon_path: null,
    created_at: '2026-05-21T09:01:00Z',
  },
];

function mockApi(command: string, args?: unknown) {
  if (command === 'list_desktop_categories') return categories;
  if (command === 'list_desktop_items') {
    const categoryId = (args as { categoryId: string }).categoryId;
    if (categoryId === 'software') return softwareItems;
    if (categoryId === 'files') return fileItems;
    return [];
  }
  if (command === 'add_desktop_paths') return addedItems;
  if (command === 'delete_desktop_item') return undefined;
  if (command === 'rename_desktop_item') {
    return {
      ...softwareItems[0],
      name: (args as { name: string }).name,
    };
  }
  if (command === 'update_desktop_category_color') {
    const { id, color } = args as { id: string; color: string | null };
    return categories.map((category) =>
      category.id === id ? { ...category, color } : category,
    );
  }
  if (command === 'delete_desktop_category') {
    return categories.filter(
      (category) => category.id !== (args as { id: string }).id,
    );
  }
  if (command === 'create_desktop_category') {
    return {
      id: 'dev-tools',
      name: '开发工具',
      kind: 'software',
      sort_order: 3,
      color: null,
      created_at: '2026-05-21T10:00:00Z',
    };
  }
  if (command === 'reorder_desktop_categories') {
    return [categories[1], categories[0], categories[2]];
  }
  if (command === 'open_desktop_item') return undefined;
  throw new Error(`Unexpected command: ${command}`);
}

describe('App', () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
    isTauriMock.mockReturnValue(false);
    listenMock.mockReset();
    listenMock.mockImplementation(async () => () => undefined);
    getCurrentWebviewMock.mockReset();
    getCurrentWindowMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args?: unknown) =>
      mockApi(command, args),
    );
  });

  it('只渲染悬浮桌面收纳窗口', async () => {
    render(<App />);

    expect(await screen.findByTestId('desktop-drop-zone')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /桌面管理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /快捷方式/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /便签/ })).not.toBeInTheDocument();
  });

  it('只调用桌面条目相关命令', async () => {
    render(<App />);

    await screen.findByText('Code');

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toEqual(
      expect.arrayContaining(['list_desktop_categories', 'list_desktop_items']),
    );
    expect(commands).not.toContain('list_notes');
    expect(commands).not.toContain('list_managed_shortcuts');
  });

  it('拖入文件时调用桌面条目添加命令', async () => {
    render(<App />);

    const dropZone = await screen.findByTestId('desktop-drop-zone');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [{ path: 'C:\\Docs\\新文件.pdf', name: '新文件.pdf' }],
      },
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('add_desktop_paths', {
        paths: ['C:\\Docs\\新文件.pdf'],
        targetCategoryId: 'software',
      });
    });
  });

  it('通过 Tauri 原生拖入快捷方式时显示添加状态', async () => {
    let dragHandler:
      | ((event: { payload: { type: string; paths?: string[] } }) => void)
      | undefined;
    const onDragDropEvent = vi.fn(async (handler) => {
      dragHandler = handler;
      return () => undefined;
    });
    isTauriMock.mockReturnValue(true);
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);
    render(<App />);

    await waitFor(() => {
      expect(onDragDropEvent).toHaveBeenCalled();
    });
    await screen.findByText('拖拽监听已就绪。');
    act(() => {
      dragHandler?.({
        payload: {
          type: 'drop',
          paths: ['C:\\Users\\Example\\Desktop\\Code.lnk'],
        },
      });
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('add_desktop_paths', {
        paths: ['C:\\Users\\Example\\Desktop\\Code.lnk'],
        targetCategoryId: 'software',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('drop-status')).toHaveTextContent('已添加 1 项');
    });
  });

  it('拖入当前文件分类时把当前分类传给后端用于类型匹配落点', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '文件' }));
    const dropZone = await screen.findByTestId('desktop-drop-zone');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [{ path: 'C:\\Docs\\新文件.pdf', name: '新文件.pdf' }],
      },
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('add_desktop_paths', {
        paths: ['C:\\Docs\\新文件.pdf'],
        targetCategoryId: 'files',
      });
    });
  });

  it('点击条目时调用打开命令', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Code' }));

    expect(invokeMock).toHaveBeenCalledWith('open_desktop_item', {
      id: 'C:\\Apps\\Code.lnk',
    });
  });

  it('右键软件图标后可以重命名并保存', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Code' }), {
      clientX: 96,
      clientY: 128,
    });
    expect(screen.queryByRole('menuitem', { name: '重命名 Code' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }));

    const dialog = await screen.findByRole('dialog', { name: '重命名' });
    const input = within(dialog).getByRole('textbox', { name: '名称' });
    await user.clear(input);
    await user.type(input, 'VS Code');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('rename_desktop_item', {
        id: 'C:\\Apps\\Code.lnk',
        name: 'VS Code',
      });
    });
    expect(await screen.findByRole('button', { name: 'VS Code' })).toBeInTheDocument();
  });

  it('右键软件图标时可以换到另一个软件分页', async () => {
    const user = userEvent.setup();
    const devToolsCategory = {
      id: 'dev-tools',
      name: '开发软件',
      kind: 'software' as const,
      sort_order: 3,
      color: null,
      created_at: '2026-05-21T10:00:00Z',
    };
    let codeCategoryId = 'software';
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      const allCategories = [...categories, devToolsCategory];
      if (command === 'list_desktop_categories') return allCategories;
      if (command === 'list_desktop_items') {
        const categoryId = (args as { categoryId: string }).categoryId;
        if (categoryId === 'software') {
          return codeCategoryId === 'software'
            ? softwareItems
            : softwareItems.filter((item) => item.id !== 'C:\\Apps\\Code.lnk');
        }
        if (categoryId === 'dev-tools') {
          return codeCategoryId === 'dev-tools'
            ? [{ ...softwareItems[0], category_id: 'dev-tools', sort_order: 0 }]
            : [];
        }
        if (categoryId === 'files') return fileItems;
        return [];
      }
      if (command === 'move_desktop_item_to_category') {
        const { id, targetCategoryId } = args as {
          id: string;
          targetCategoryId: string;
        };
        expect(id).toBe('C:\\Apps\\Code.lnk');
        codeCategoryId = targetCategoryId;
        return { ...softwareItems[0], category_id: targetCategoryId, sort_order: 0 };
      }
      return mockApi(command, args);
    });
    render(<App />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Code' }), {
      clientX: 96,
      clientY: 128,
    });
    expect(screen.queryByRole('menuitem', { name: '换分页到 开发软件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '开发软件' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('menuitem', { name: '换分页' }));
    await user.click(await screen.findByRole('menuitem', { name: '开发软件' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('move_desktop_item_to_category', {
        id: 'C:\\Apps\\Code.lnk',
        targetCategoryId: 'dev-tools',
      });
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_desktop_items', {
        categoryId: 'dev-tools',
      });
    });
    expect(await screen.findByRole('button', { name: '开发软件' })).toHaveClass('active');
    expect(await screen.findByRole('button', { name: 'Code' })).toBeInTheDocument();
  });

  it('搜索框按名称过滤当前分类条目', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Code' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Notepad' })).toBeInTheDocument();

    await user.type(await screen.findByRole('searchbox', { name: '搜索' }), 'note');

    expect(screen.queryByRole('button', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notepad' })).toBeInTheDocument();
  });

  it('右键菜单中移除条目并刷新列表', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('button', { name: '移除 Code' })).not.toBeInTheDocument();

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Code' }), {
      clientX: 96,
      clientY: 128,
    });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '移除 Code' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('menuitem', { name: '移除' }));

    expect(invokeMock).toHaveBeenCalledWith('delete_desktop_item', {
      id: 'C:\\Apps\\Code.lnk',
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_desktop_items', {
        categoryId: 'software',
      });
    });
  });

  it('软件图标上不直接显示移除按钮', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Code' });

    expect(screen.queryByRole('button', { name: '移除 Code' })).not.toBeInTheDocument();
  });

  it('拖动软件图标预览换位后松手在占位图标上仍会保存顺序', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const codeItem = (await screen.findByRole('button', { name: 'Code' })).closest(
      '[data-item-id]',
    );
    const notepadItem = (await screen.findByRole('button', { name: 'Notepad' })).closest(
      '[data-item-id]',
    );
    if (!codeItem || !notepadItem) throw new Error('missing software item wrappers');

    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi
        .fn()
        .mockReturnValueOnce([notepadItem])
        .mockReturnValue([codeItem]),
    });

    try {
      dispatchPointerEvent(codeItem, 'pointerdown', 12, 12);
      dispatchPointerEvent(document, 'pointermove', 96, 12);

      await waitFor(() => {
        expect(
          Array.from(document.querySelectorAll<HTMLElement>('.software-item')).map(
            (element) => element.dataset.itemId,
          ),
        ).toEqual(['C:\\Tools\\Notepad.lnk', 'C:\\Apps\\Code.lnk']);
      });

      dispatchPointerEvent(document, 'pointerup', 96, 12);

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_items', {
          categoryId: 'software',
          orderedIds: ['C:\\Tools\\Notepad.lnk', 'C:\\Apps\\Code.lnk'],
        });
      });
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('右键上方分类时显示删除分类选项并刷新到剩余分类', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: categories[0].name }), {
      clientX: 40,
      clientY: 40,
    });

    await user.click(
      await screen.findByRole('menuitem', {
        name: `删除分类 ${categories[0].name}`,
      }),
    );

    expect(invokeMock).toHaveBeenCalledWith('delete_desktop_category', {
      id: 'software',
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_desktop_items', {
        categoryId: 'files',
      });
    });
  });

  it('右键上方分类时可以设置半透明自定义颜色', async () => {
    const user = userEvent.setup();
    render(<App />);

    const softwareCategory = await screen.findByRole('button', { name: '软件' });
    fireEvent.contextMenu(softwareCategory, {
      clientX: 40,
      clientY: 40,
    });
    await user.click(await screen.findByRole('menuitem', { name: '设置颜色 软件' }));

    const dialog = await screen.findByRole('dialog', { name: '设置分类颜色' });
    fireEvent.change(within(dialog).getByLabelText('自定义颜色'), {
      target: { value: '#22c55e' },
    });
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_desktop_category_color', {
        id: 'software',
        color: '#22c55e',
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '软件' })).toHaveStyle({
        backgroundColor: 'rgba(34, 197, 94, 0.58)',
      });
    });
  });

  it('新建分类时用按钮选择类型而不是手动输入类型', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('不应该再使用 prompt 输入分类类型');
    });
    render(<App />);

    try {
      await user.click(await screen.findByRole('button', { name: '新增分类' }));
      const dialog = await screen.findByRole('dialog', { name: '新建分类' });
      expect(dialog).toBeInTheDocument();

      await user.type(within(dialog).getByRole('textbox', { name: '分类名称' }), '资料');
      await user.click(within(dialog).getByRole('button', { name: '文件' }));
      await user.click(within(dialog).getByRole('button', { name: '创建' }));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('create_desktop_category', {
          name: '资料',
          kind: 'file',
        });
      });
      expect(promptSpy).not.toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('拖动顶部分类时交换顺序并保存', async () => {
    const data = new Map<string, string>();
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      getData: vi.fn((key: string) => data.get(key) ?? ''),
      setData: vi.fn((key: string, value: string) => {
        data.set(key, value);
      }),
    };
    render(<App />);

    const software = await screen.findByRole('button', { name: '软件' });
    const files = await screen.findByRole('button', { name: '文件' });
    fireEvent.dragStart(software, { dataTransfer });
    fireEvent.dragOver(files, { dataTransfer });
    fireEvent.drop(files, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-desktop-category-id',
      'software',
    );
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_categories', {
        orderedIds: ['files', 'software', 'folders'],
      });
    });
  });

  it('按住顶部分类拖到另一个分类时交换顺序并保存', async () => {
    render(<App />);

    const software = await screen.findByRole('button', { name: '软件' });
    const files = await screen.findByRole('button', { name: '文件' });
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => files),
    });

    try {
      fireEvent.pointerDown(software, {
        button: 0,
        clientX: 12,
        clientY: 12,
        pointerId: 1,
        pointerType: 'mouse',
      });
      fireEvent.pointerMove(document, {
        clientX: 96,
        clientY: 12,
        pointerId: 1,
        pointerType: 'mouse',
      });
      fireEvent.pointerUp(document, {
        clientX: 96,
        clientY: 12,
        pointerId: 1,
        pointerType: 'mouse',
      });

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_categories', {
          orderedIds: ['files', 'software', 'folders'],
        });
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    }
  });

  it('拖动动画覆盖目标分类时仍然按下方分类完成换位', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const software = await screen.findByRole('button', { name: categories[0].name });
    const files = await screen.findByRole('button', { name: categories[1].name });
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => software),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [software, files]),
    });

    try {
      dispatchPointerEvent(software, 'pointerdown', 12, 12);
      dispatchPointerEvent(document, 'pointermove', 96, 12);
      dispatchPointerEvent(document, 'pointerup', 96, 12);

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_categories', {
          orderedIds: ['files', 'software', 'folders'],
        });
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('previews category order while dragging over another category', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const software = await screen.findByRole('button', { name: categories[0].name });
    const files = await screen.findByRole('button', { name: categories[1].name });
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => software),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [software, files]),
    });

    try {
      dispatchPointerEvent(software, 'pointerdown', 12, 12);
      dispatchPointerEvent(document, 'pointermove', 96, 12);

      await waitFor(() => {
        expect(
          Array.from(document.querySelectorAll<HTMLElement>('.category-pill')).map(
            (element) => element.dataset.categoryId,
          ),
        ).toEqual(['files', 'software', 'folders']);
      });
      expect(invokeMock).not.toHaveBeenCalledWith('reorder_desktop_categories', {
        orderedIds: ['files', 'software', 'folders'],
      });

      dispatchPointerEvent(document, 'pointerup', 96, 12);

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_categories', {
          orderedIds: ['files', 'software', 'folders'],
        });
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('keeps the preview stable when the pointer is over the dragged placeholder', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const software = await screen.findByRole('button', { name: categories[0].name });
    const files = await screen.findByRole('button', { name: categories[1].name });
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => software),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi
        .fn()
        .mockReturnValueOnce([software, files])
        .mockReturnValue([software]),
    });

    try {
      dispatchPointerEvent(software, 'pointerdown', 12, 12);
      dispatchPointerEvent(document, 'pointermove', 96, 12);

      await waitFor(() => {
        expect(
          Array.from(document.querySelectorAll<HTMLElement>('.category-pill')).map(
            (element) => element.dataset.categoryId,
          ),
        ).toEqual(['files', 'software', 'folders']);
      });

      dispatchPointerEvent(document, 'pointermove', 97, 12);

      await waitFor(() => {
        expect(
          Array.from(document.querySelectorAll<HTMLElement>('.category-pill')).map(
            (element) => element.dataset.categoryId,
          ),
        ).toEqual(['files', 'software', 'folders']);
      });
      expect(screen.getByTestId('category-drag-overlay')).toHaveStyle({
        left: '85px',
        top: '0px',
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('顶部分类换位时用位移动画过渡', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const software = await screen.findByRole('button', { name: categories[0].name });
    const files = await screen.findByRole('button', { name: categories[1].name });
    const folders = await screen.findByRole('button', { name: categories[2].name });
    for (const element of [software, files, folders]) {
      vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
        const categoryButtons = Array.from(document.querySelectorAll('.category-pill'));
        const index = categoryButtons.indexOf(element);
        const left = index * 80;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + 70,
          bottom: 28,
          width: 70,
          height: 28,
          toJSON: () => undefined,
        };
      });
    }
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => files),
    });

    try {
      dispatchPointerEvent(software, 'pointerdown', 12, 12);
      dispatchPointerEvent(document, 'pointermove', 96, 12);

      await waitFor(() => {
        expect(files).toHaveStyle({ transform: 'translate(80px, 0px)' });
        expect(software).toHaveClass('drag-placeholder');
      });
      const overlay = screen.getByTestId('category-drag-overlay');
      expect(overlay).toHaveTextContent(categories[0].name);
      expect(overlay).toHaveStyle({
        left: '84px',
        top: '0px',
        width: '70px',
        height: '28px',
      });
      expect(requestAnimationFrameSpy).toHaveBeenCalled();

      rafCallbacks.forEach((callback) => callback(0));

      expect(files.style.transform).toBe('');
      expect(overlay).toHaveStyle({ left: '84px', top: '0px' });

      dispatchPointerEvent(document, 'pointerup', 96, 12);

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('reorder_desktop_categories', {
          orderedIds: ['files', 'software', 'folders'],
        });
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it('顶部分类拖动移动过程中也有跟手位移动画', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const software = await screen.findByRole('button', { name: categories[0].name });
    dispatchPointerEvent(software, 'pointerdown', 12, 12);
    dispatchPointerEvent(document, 'pointermove', 54, 28);

    await waitFor(() => {
      expect(software).toHaveClass('drag-placeholder');
      expect(screen.getByTestId('category-drag-overlay')).toHaveStyle({
        left: '42px',
        top: '16px',
      });
    });
  });

  it('positions the drag overlay relative to the floating window', async () => {
    function dispatchPointerEvent(
      target: Document | Element,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      fireEvent(target, event);
    }

    render(<App />);

    const dropZone = await screen.findByTestId('desktop-drop-zone');
    vi.spyOn(dropZone, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 320,
      bottom: 260,
      width: 300,
      height: 230,
      toJSON: () => undefined,
    });
    const software = await screen.findByRole('button', { name: categories[0].name });
    vi.spyOn(software, 'getBoundingClientRect').mockReturnValue({
      x: 40,
      y: 50,
      left: 40,
      top: 50,
      right: 110,
      bottom: 78,
      width: 70,
      height: 28,
      toJSON: () => undefined,
    });

    dispatchPointerEvent(software, 'pointerdown', 50, 60);
    dispatchPointerEvent(document, 'pointermove', 100, 80);

    await waitFor(() => {
      expect(screen.getByTestId('category-drag-overlay')).toHaveStyle({
        left: '70px',
        top: '40px',
      });
    });
  });

  it('按下顶部拖动条时启动窗口移动', async () => {
    const startDragging = vi.fn(async () => undefined);
    getCurrentWindowMock.mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);

    fireEvent.mouseDown(await screen.findByTestId('window-drag-region'), { button: 0 });

    expect(startDragging).toHaveBeenCalled();
  });

  it('按下面板空白区域时启动窗口移动', async () => {
    const startDragging = vi.fn(async () => undefined);
    getCurrentWindowMock.mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);

    fireEvent.mouseDown(await screen.findByTestId('desktop-drop-zone'), { button: 0 });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('点击搜索框和条目时不启动窗口移动', async () => {
    const startDragging = vi.fn(async () => undefined);
    getCurrentWindowMock.mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);

    fireEvent.mouseDown(await screen.findByRole('searchbox', { name: '搜索' }), { button: 0 });
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'Code' }), { button: 0 });

    expect(startDragging).not.toHaveBeenCalled();
  });

  it('点击隐藏按钮时隐藏主窗口', async () => {
    const hide = vi.fn(async () => undefined);
    const startDragging = vi.fn(async () => undefined);
    getCurrentWindowMock.mockReturnValue({
      hide,
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: '隐藏窗口' }));

    expect(hide).toHaveBeenCalledTimes(1);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('收到托盘刷新事件时重新加载分类和当前分类内容', async () => {
    let refreshHandler: (() => void) | undefined;
    isTauriMock.mockReturnValue(true);
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent: vi.fn(async () => () => undefined),
    } as unknown as ReturnType<typeof getCurrentWebview>);
    listenMock.mockImplementation(async (event, handler) => {
      if (event === 'desktop-manager://refresh') {
        refreshHandler = () => handler({ event, payload: undefined, id: 1 });
      }
      return () => undefined;
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Code' });
    invokeMock.mockClear();
    act(() => {
      refreshHandler?.();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_desktop_categories');
    });
    expect(invokeMock).toHaveBeenCalledWith('list_desktop_items', {
      categoryId: 'software',
    });
  });

  it('收到托盘锁定位置事件后禁止拖动窗口', async () => {
    let lockHandler: ((locked: boolean) => void) | undefined;
    const startDragging = vi.fn(async () => undefined);
    isTauriMock.mockReturnValue(true);
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent: vi.fn(async () => () => undefined),
    } as unknown as ReturnType<typeof getCurrentWebview>);
    listenMock.mockImplementation(async (event, handler) => {
      if (event === 'desktop-manager://lock-position') {
        lockHandler = (locked) => handler({ event, payload: locked, id: 1 });
      }
      return () => undefined;
    });
    getCurrentWindowMock.mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    render(<App />);

    const dropZone = await screen.findByTestId('desktop-drop-zone');
    act(() => {
      lockHandler?.(true);
    });
    fireEvent.mouseDown(dropZone, { button: 0 });
    expect(startDragging).not.toHaveBeenCalled();

    act(() => {
      lockHandler?.(false);
    });
    fireEvent.mouseDown(dropZone, { button: 0 });
    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
