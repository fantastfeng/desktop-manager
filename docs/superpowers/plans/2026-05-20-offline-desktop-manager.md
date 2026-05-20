# 离线桌面管理工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完全离线的 Windows 桌面管理工具，支持快捷方式收纳、搜索启动、恢复，以及本地独立便签窗口。

**Architecture:** Tauri 提供桌面壳和多窗口能力；React/TypeScript 负责主窗口与便签窗口 UI；Rust 负责本地文件操作、SQLite、快捷方式启动和窗口命令。所有数据存储在 `%LOCALAPPDATA%\OfflineDesktopManager`，第一版不包含联网、登录、同步、托盘、全局快捷键或自动分类。

**Tech Stack:** Tauri, React, TypeScript, Rust, SQLite, Vite, Vitest, Cargo tests

---

## 文件结构

项目根目录：`E:\桌面管理`

- `package.json`：前端依赖和脚本。
- `index.html`：Vite HTML 入口。
- `vite.config.ts`：Vite 和 Vitest 配置。
- `tsconfig.json`：TypeScript 配置。
- `src/main.tsx`：React 入口。
- `src/App.tsx`：根据 URL 显示主窗口或便签窗口。
- `src/App.css`：全局、主窗口、便签窗口样式。
- `src/types.ts`：前端数据类型。
- `src/api.ts`：Tauri invoke 封装。
- `src/components/ShortcutPanel.tsx`：快捷方式管理 UI。
- `src/components/NotePanel.tsx`：便签管理 UI。
- `src/components/NoteWindow.tsx`：独立便签窗口 UI。
- `src/test/setup.ts`：Vitest mock 配置。
- `src/test/App.test.tsx`：前端基础测试。
- `src-tauri/Cargo.toml`：Rust 依赖。
- `src-tauri/tauri.conf.json`：Tauri 配置。
- `src-tauri/src/main.rs`：Tauri 入口和命令注册。
- `src-tauri/src/app_state.rs`：应用目录、数据库连接和共享状态。
- `src-tauri/src/db.rs`：SQLite 迁移和 CRUD。
- `src-tauri/src/error.rs`：统一错误类型。
- `src-tauri/src/models.rs`：Rust 数据模型。
- `src-tauri/src/shortcuts.rs`：快捷方式扫描、收纳、启动、恢复。
- `src-tauri/src/notes.rs`：便签 CRUD 命令。
- `src-tauri/src/windows.rs`：便签窗口创建和聚焦。

---

### Task 1: 初始化项目骨架

**Files:**
- Create: `E:\桌面管理\package.json`
- Create: `E:\桌面管理\index.html`
- Create: `E:\桌面管理\vite.config.ts`
- Create: `E:\桌面管理\tsconfig.json`
- Create: `E:\桌面管理\src\main.tsx`
- Create: `E:\桌面管理\src\App.tsx`
- Create: `E:\桌面管理\src\App.css`
- Create: `E:\桌面管理\src-tauri\Cargo.toml`
- Create: `E:\桌面管理\src-tauri\tauri.conf.json`
- Create: `E:\桌面管理\src-tauri\src\main.rs`

- [ ] **Step 1: 创建目录**

Run:

```powershell
Set-Location 'E:\桌面管理'
New-Item -ItemType Directory -Force -Path 'src','src\components','src\test','src-tauri\src' | Out-Null
```

Expected: 目录创建成功。

- [ ] **Step 2: 写入前端基础配置**

`package.json` 使用这些脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "tauri": "tauri"
  }
}
```

依赖使用：`react`、`react-dom`、`@tauri-apps/api`、`vite`、`typescript`、`lucide-react`、`vitest`、`@testing-library/react`、`jsdom`。

`src/main.tsx` 渲染 `<App />`；`src/App.tsx` 先显示标题“离线桌面管理”；`src/App.css` 设置基础字体、背景和页面边距。

- [ ] **Step 3: 写入 Tauri 基础配置**

`src-tauri/Cargo.toml` 添加依赖：`tauri = "2"`、`tauri-plugin-opener = "2"`、`serde`、`serde_json`、`thiserror`、`rusqlite` bundled、`uuid`、`chrono`、`dirs`。

`src-tauri/tauri.conf.json` 配置主窗口：label `main`，标题 `离线桌面管理`，宽 `1040`，高 `720`，devUrl `http://localhost:5173`。

`src-tauri/src/main.rs` 初始内容：

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
```

- [ ] **Step 4: 验证骨架**

Run:

```powershell
Set-Location 'E:\桌面管理'
npm install
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: 前端构建成功，Rust 测试命令成功。

- [ ] **Step 5: Commit**

```powershell
git add .
git commit -m "chore: initialize offline desktop manager"
```

---

### Task 2: 建立本地状态、数据库和模型

**Files:**
- Create: `E:\桌面管理\src-tauri\src\app_state.rs`
- Create: `E:\桌面管理\src-tauri\src\db.rs`
- Create: `E:\桌面管理\src-tauri\src\error.rs`
- Create: `E:\桌面管理\src-tauri\src\models.rs`
- Modify: `E:\桌面管理\src-tauri\src\main.rs`

- [ ] **Step 1: 写数据库迁移测试**

在 `db.rs` 中先写 `migrate_creates_required_tables`，使用 `Connection::open_in_memory()`，调用 `migrate(&conn)` 后查询 `sqlite_master`，断言 `shortcuts` 和 `notes` 两张表存在。

核心迁移 SQL：

```sql
CREATE TABLE IF NOT EXISTS shortcuts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  original_path TEXT NOT NULL,
  managed_path TEXT NOT NULL,
  target_path TEXT,
  icon_path TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  color TEXT NOT NULL,
  x INTEGER,
  y INTEGER,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  is_open INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: 运行迁移测试**

Run:

```powershell
cargo test --manifest-path E:\桌面管理\src-tauri\Cargo.toml migrate_creates_required_tables
```

Expected: `1 passed`。

- [ ] **Step 3: 实现模型**

`models.rs` 定义：

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShortcutRecord { pub id: String, pub name: String, pub original_path: String, pub managed_path: String, pub target_path: Option<String>, pub icon_path: Option<String>, pub last_opened_at: Option<String>, pub created_at: String }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NoteRecord { pub id: String, pub title: String, pub content: String, pub color: String, pub x: Option<i32>, pub y: Option<i32>, pub width: i32, pub height: i32, pub is_open: bool, pub updated_at: String }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NoteInput { pub title: String, pub content: String, pub color: String }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NoteUpdate { pub id: String, pub title: String, pub content: String, pub color: String, pub x: Option<i32>, pub y: Option<i32>, pub width: i32, pub height: i32, pub is_open: bool }
```

- [ ] **Step 4: 实现错误和应用状态**

`error.rs` 定义 `AppError`：`DesktopNotFound`、`DataDirUnavailable`、`File(String)`、`Database(String)`、`RestoreConflict`、`Window(String)`，并提供 `ErrorResponse { message: String }`。

`app_state.rs` 定义：

```rust
pub struct AppState {
    pub conn: std::sync::Mutex<rusqlite::Connection>,
    pub data_dir: std::path::PathBuf,
    pub shortcuts_dir: std::path::PathBuf,
}
```

`AppState::initialize()` 创建 `%LOCALAPPDATA%\OfflineDesktopManager`、`Shortcuts` 子目录，打开 `data.db` 并执行 `db::migrate()`。

- [ ] **Step 5: 在 `main.rs` 注册状态**

`main.rs` 添加模块：`app_state`、`db`、`error`、`models`，启动前调用 `AppState::initialize()`，并 `.manage(state)`。

- [ ] **Step 6: 验证**

Run:

```powershell
cargo test --manifest-path E:\桌面管理\src-tauri\Cargo.toml
```

Expected: 所有 Rust 测试通过。

- [ ] **Step 7: Commit**

```powershell
git add src-tauri\src
git commit -m "feat: add local state and database schema"
```

---

### Task 3: 实现快捷方式后端

**Files:**
- Create: `E:\桌面管理\src-tauri\src\shortcuts.rs`
- Modify: `E:\桌面管理\src-tauri\src\db.rs`
- Modify: `E:\桌面管理\src-tauri\src\main.rs`

- [ ] **Step 1: 写文件名冲突测试**

在 `shortcuts.rs` 中测试 `unique_managed_path(dir, "工具.lnk")`：当文件不存在时返回 `工具.lnk`；当已存在时返回 `工具 (1).lnk`。

- [ ] **Step 2: 实现快捷方式函数**

实现：

```rust
pub fn desktop_dir() -> AppResult<PathBuf>;
pub fn unique_managed_path(dir: &Path, file_name: &str) -> PathBuf;
#[tauri::command] pub fn scan_desktop_shortcuts() -> Result<Vec<ShortcutRecord>, ErrorResponse>;
#[tauri::command] pub fn list_managed_shortcuts(state: State<AppState>) -> Result<Vec<ShortcutRecord>, ErrorResponse>;
#[tauri::command] pub fn collect_shortcut(path: String, state: State<AppState>) -> Result<ShortcutRecord, ErrorResponse>;
#[tauri::command] pub fn launch_shortcut(id: String, state: State<AppState>) -> Result<(), ErrorResponse>;
#[tauri::command] pub fn restore_shortcut(id: String, state: State<AppState>) -> Result<(), ErrorResponse>;
```

行为要求：

- `scan_desktop_shortcuts` 只扫描当前用户桌面下扩展名为 `.lnk` 的文件。
- `collect_shortcut` 使用 `fs::rename` 移动到 `%LOCALAPPDATA%\OfflineDesktopManager\Shortcuts`，写入数据库。
- `launch_shortcut` 使用 `tauri_plugin_opener::open_path` 打开托管 `.lnk`。
- `restore_shortcut` 如果原路径已存在，返回 `RestoreConflict`，绝不覆盖。

- [ ] **Step 3: 补充数据库 CRUD**

在 `db.rs` 添加：`insert_shortcut`、`list_shortcuts`、`find_shortcut`、`delete_shortcut`、`mark_shortcut_opened`。

- [ ] **Step 4: 注册命令**

`main.rs` 添加 `mod shortcuts;`，并在 `invoke_handler` 注册五个快捷方式命令。

- [ ] **Step 5: 验证**

Run:

```powershell
cargo test --manifest-path E:\桌面管理\src-tauri\Cargo.toml
```

Expected: 文件名冲突测试和数据库测试均通过。

- [ ] **Step 6: Commit**

```powershell
git add src-tauri\src
git commit -m "feat: manage desktop shortcuts locally"
```

---

### Task 4: 实现便签后端和多窗口

**Files:**
- Create: `E:\桌面管理\src-tauri\src\notes.rs`
- Create: `E:\桌面管理\src-tauri\src\windows.rs`
- Modify: `E:\桌面管理\src-tauri\src\db.rs`
- Modify: `E:\桌面管理\src-tauri\src\main.rs`

- [ ] **Step 1: 补充便签数据库 CRUD**

在 `db.rs` 添加：`insert_note`、`list_notes`、`find_note`、`update_note`、`delete_note`。`is_open` 使用 SQLite INTEGER 存储，Rust 中转换为 bool。

- [ ] **Step 2: 实现便签命令**

`notes.rs` 实现：

```rust
#[tauri::command] pub fn list_notes(state: State<AppState>) -> Result<Vec<NoteRecord>, ErrorResponse>;
#[tauri::command] pub fn create_note(input: NoteInput, app: AppHandle, state: State<AppState>) -> Result<NoteRecord, ErrorResponse>;
#[tauri::command] pub fn update_note(input: NoteUpdate, state: State<AppState>) -> Result<NoteRecord, ErrorResponse>;
#[tauri::command] pub fn delete_note(id: String, state: State<AppState>) -> Result<(), ErrorResponse>;
#[tauri::command] pub fn open_note(id: String, app: AppHandle, state: State<AppState>) -> Result<(), ErrorResponse>;
```

默认新便签：标题 `新便签`，颜色 `#fff4b8`，宽 `320`，高 `260`，`is_open = true`。

- [ ] **Step 3: 实现便签窗口**

`windows.rs` 实现 `open_note_window(app, note)`：窗口 label 为 `note-{id}`；如果窗口已存在则聚焦；否则打开 URL `/note/{id}`，设置标题、宽高、可调整大小，并在 `x/y` 存在时恢复位置。

- [ ] **Step 4: 注册命令**

`main.rs` 添加 `mod notes; mod windows;`，并注册五个便签命令。

- [ ] **Step 5: 验证**

Run:

```powershell
cargo test --manifest-path E:\桌面管理\src-tauri\Cargo.toml
```

Expected: 所有 Rust 测试通过。

- [ ] **Step 6: Commit**

```powershell
git add src-tauri\src
git commit -m "feat: add local sticky note backend"
```

---

### Task 5: 实现前端 API、主窗口和便签窗口

**Files:**
- Create: `E:\桌面管理\src\types.ts`
- Create: `E:\桌面管理\src\api.ts`
- Create: `E:\桌面管理\src\components\ShortcutPanel.tsx`
- Create: `E:\桌面管理\src\components\NotePanel.tsx`
- Create: `E:\桌面管理\src\components\NoteWindow.tsx`
- Modify: `E:\桌面管理\src\App.tsx`
- Modify: `E:\桌面管理\src\App.css`

- [ ] **Step 1: 定义前端类型**

`types.ts` 定义 `ShortcutRecord`、`NoteRecord`、`NoteInput`、`NoteUpdate`，字段名与 Rust 模型完全一致，使用 snake_case。

- [ ] **Step 2: 封装 Tauri API**

`api.ts` 使用 `invoke` 封装命令：`scanDesktopShortcuts`、`listManagedShortcuts`、`collectShortcut`、`launchShortcut`、`restoreShortcut`、`listNotes`、`createNote`、`updateNote`、`deleteNote`、`openNote`。

示例：

```ts
export function collectShortcut(path: string) {
  return invoke<ShortcutRecord>('collect_shortcut', { path });
}
```

- [ ] **Step 3: 实现 `ShortcutPanel`**

UI 包含：扫描按钮、搜索输入、桌面快捷方式列表、已收纳快捷方式列表。按钮行为：收纳调用 `collectShortcut`；启动调用 `launchShortcut`；恢复调用 `restoreShortcut`。

- [ ] **Step 4: 实现 `NotePanel`**

UI 包含：新建按钮、便签卡片列表、打开按钮、删除按钮。新建调用 `createNote({ title: '新便签', content: '', color: '#fff4b8' })`。

- [ ] **Step 5: 实现 `NoteWindow`**

从 `window.location.pathname` 解析 `/note/{id}`。加载 `listNotes()` 找到对应便签。标题、正文、颜色编辑后使用 400ms 防抖调用 `updateNote` 保存。

- [ ] **Step 6: 更新 `App.tsx`**

如果 URL 以 `/note/` 开头，渲染 `<NoteWindow />`；否则渲染主窗口，包含 `<ShortcutPanel />` 和 `<NotePanel />`。

- [ ] **Step 7: 更新样式**

`App.css` 添加主窗口双栏布局、列表、按钮、便签卡片、便签窗口 textarea 和颜色 swatch。宽度小于 900px 时主窗口改为单栏。

- [ ] **Step 8: 验证**

Run:

```powershell
npm run build
```

Expected: TypeScript 和 Vite 构建成功。

- [ ] **Step 9: Commit**

```powershell
git add src
git commit -m "feat: add desktop manager interface"
```

---

### Task 6: 添加测试和最终手动验收

**Files:**
- Create: `E:\桌面管理\src\test\setup.ts`
- Create: `E:\桌面管理\src\test\App.test.tsx`
- Modify: `E:\桌面管理\vite.config.ts`

- [ ] **Step 1: Mock Tauri invoke**

`setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'scan_desktop_shortcuts') return [];
    if (command === 'list_managed_shortcuts') return [];
    if (command === 'list_notes') return [];
    return undefined;
  }),
}));
```

- [ ] **Step 2: 添加渲染测试**

`App.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('App', () => {
  it('renders main sections', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '离线桌面管理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '快捷方式' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '便签' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 自动验证**

Run:

```powershell
npm test
npm run build
cargo test --manifest-path E:\桌面管理\src-tauri\Cargo.toml
```

Expected: 前端测试、前端构建、Rust 测试全部通过。

- [ ] **Step 4: 手动验证 Windows 行为**

Run:

```powershell
npm run tauri dev
```

Expected:

- 主窗口打开。
- 点击“扫描”显示桌面 `.lnk`。
- 收纳后，桌面上的 `.lnk` 移动到 `%LOCALAPPDATA%\OfflineDesktopManager\Shortcuts`。
- 已收纳快捷方式可以搜索、启动。
- 恢复后，快捷方式回到原桌面路径。
- 新建便签会打开独立便签窗口。
- 编辑标题、正文、颜色后，关闭并重新打开仍保留内容。
- 断网状态下应用仍可完成上述流程。

- [ ] **Step 5: Commit**

```powershell
git add .
git commit -m "test: add verification coverage"
```

---

## 自检结果

- Spec 覆盖：计划覆盖快捷方式扫描、收纳、搜索启动、恢复、本地便签、独立便签窗口、本地 SQLite、错误处理和离线运行约束。
- 占位符扫描：计划不包含未决占位项；每个任务都有文件、步骤、验证命令和提交点。
- 类型一致性：前端类型和 Rust 模型字段一致，均使用 snake_case。
- 范围控制：计划不实现联网、登录、云同步、托盘常驻、全局快捷键、自动分类规则或插件系统。
