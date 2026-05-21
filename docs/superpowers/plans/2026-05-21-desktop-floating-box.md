# 桌面悬浮小框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把应用实现为一个半透明、可拖动、支持拖拽自动分类的软件/文件/文件夹桌面悬浮小框。

**Architecture:** 后端新增通用桌面条目模型和 Tauri 命令，SQLite 持久化分类与条目，打开条目时使用 `tauri-plugin-opener`。前端用一个新的 `FloatingBox` 取代主界面的快捷方式/便签双栏，负责分类切换、拖拽添加、软件图标网格、文件/文件夹详细信息列表和排序。

**Tech Stack:** Tauri 2, Rust, rusqlite, React 18, TypeScript, Vite, Vitest, Testing Library, lucide-react。

---

## File Structure

- Modify: `E:\桌面管理\src-tauri\src\models.rs`
  - 新增 `DesktopCategoryRecord`、`DesktopItemRecord`、`DesktopItemKind`、`DesktopItemInput`。
- Modify: `E:\桌面管理\src-tauri\src\db.rs`
  - 新增 `desktop_categories`、`desktop_items` 表迁移，以及分类/条目 CRUD 查询函数。
- Create: `E:\桌面管理\src-tauri\src\desktop_items.rs`
  - 新增 Tauri 命令：列出分类、创建分类、列出条目、添加路径、打开条目，并在添加软件时提取图标。
- Modify: `E:\桌面管理\src-tauri\src\main.rs`
  - 注册 `desktop_items` 模块和命令。
- Modify: `E:\桌面管理\src\types.ts`
  - 新增前端分类、条目、排序类型。
- Modify: `E:\桌面管理\src\api.ts`
  - 新增桌面盒子相关 invoke 封装。
- Create: `E:\桌面管理\src\components\FloatingBox.tsx`
  - 实现悬浮小框主 UI、拖拽添加、分类切换、排序和打开条目。
- Modify: `E:\桌面管理\src\App.tsx`
  - 主路由渲染 `FloatingBox`，保留便签窗口路由。
- Modify: `E:\桌面管理\src\App.css`
  - 改成紧凑、半透明、竖向小抽屉视觉。
- Modify: `E:\桌面管理\src\test\App.test.tsx`
  - 覆盖默认分类、拖拽自动分类、排序、软件图标网格和窗口配置。
- Modify: `E:\桌面管理\src\test\setup.ts`
  - 如有需要，补充 Tauri 拖拽/窗口 API mock。

---

### Task 1: 后端数据模型和数据库迁移

**Files:**
- Modify: `E:\桌面管理\src-tauri\src\models.rs`
- Modify: `E:\桌面管理\src-tauri\src\db.rs`

- [ ] **Step 1: 写失败的数据库测试**

在 `E:\桌面管理\src-tauri\src\db.rs` 的 `#[cfg(test)] mod tests` 中加入：

```rust
#[test]
fn desktop_item_crud_persists_categories_and_items() {
    let conn = Connection::open_in_memory().expect("open in-memory database");
    migrate(&conn).expect("run migrations");

    let categories = list_desktop_categories(&conn).expect("list categories");
    assert_eq!(
        categories
            .iter()
            .map(|category| category.name.as_str())
            .collect::<Vec<_>>(),
        vec!["软件", "文件", "文件夹"]
    );

    let item = DesktopItemRecord {
        id: "item-1".to_string(),
        category_id: "files".to_string(),
        name: "方案.docx".to_string(),
        path: r"C:\Users\me\Desktop\方案.docx".to_string(),
        kind: DesktopItemKind::File,
        modified_at: Some("2026-05-21T10:24:00Z".to_string()),
        icon_path: None,
        created_at: "2026-05-21T10:25:00Z".to_string(),
    };

    insert_desktop_item(&conn, &item).expect("insert desktop item");

    assert_eq!(
        list_desktop_items(&conn, "files").expect("list file items"),
        vec![item.clone()]
    );
    assert_eq!(
        find_desktop_item(&conn, "item-1").expect("find desktop item"),
        Some(item)
    );
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd E:\桌面管理\src-tauri
cargo test desktop_item_crud_persists_categories_and_items
```

Expected: FAIL，错误包含缺少 `DesktopItemRecord`、`DesktopItemKind`、`list_desktop_categories`、`insert_desktop_item`、`list_desktop_items` 或 `find_desktop_item`。

- [ ] **Step 3: 实现模型**

在 `E:\桌面管理\src-tauri\src\models.rs` 加入：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopCategoryRecord {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DesktopItemKind {
    Software,
    File,
    Folder,
}

impl DesktopItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Software => "software",
            Self::File => "file",
            Self::Folder => "folder",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "software" => Self::Software,
            "folder" => Self::Folder,
            _ => Self::File,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopItemRecord {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub path: String,
    pub kind: DesktopItemKind,
    pub modified_at: Option<String>,
    pub icon_path: Option<String>,
    pub created_at: String,
}
```

- [ ] **Step 4: 实现迁移和查询**

在 `E:\桌面管理\src-tauri\src\db.rs`：

```rust
use crate::models::{
    DesktopCategoryRecord, DesktopItemKind, DesktopItemRecord, NoteRecord, ShortcutRecord,
};
```

在 `migrate` 的 SQL 中新增：

```sql
CREATE TABLE IF NOT EXISTS desktop_categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_items (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    modified_at TEXT,
    icon_path TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(category_id) REFERENCES desktop_categories(id)
);

INSERT OR IGNORE INTO desktop_categories (id, name, sort_order, created_at)
VALUES
    ('software', '软件', 0, '1970-01-01T00:00:00Z'),
    ('files', '文件', 1, '1970-01-01T00:00:00Z'),
    ('folders', '文件夹', 2, '1970-01-01T00:00:00Z');
```

新增函数：

```rust
pub fn list_desktop_categories(conn: &Connection) -> rusqlite::Result<Vec<DesktopCategoryRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, name, sort_order, created_at
        FROM desktop_categories
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
        ",
    )?;

    statement
        .query_map([], |row| {
            Ok(DesktopCategoryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect()
}

pub fn insert_desktop_category(
    conn: &Connection,
    category: &DesktopCategoryRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO desktop_categories (id, name, sort_order, created_at)
        VALUES (?1, ?2, ?3, ?4)
        ",
        (&category.id, &category.name, category.sort_order, &category.created_at),
    )?;
    Ok(())
}

pub fn insert_desktop_item(conn: &Connection, item: &DesktopItemRecord) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT OR REPLACE INTO desktop_items (
            id, category_id, name, path, kind, modified_at, icon_path, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        (
            &item.id,
            &item.category_id,
            &item.name,
            &item.path,
            item.kind.as_str(),
            &item.modified_at,
            &item.icon_path,
            &item.created_at,
        ),
    )?;
    Ok(())
}

pub fn list_desktop_items(
    conn: &Connection,
    category_id: &str,
) -> rusqlite::Result<Vec<DesktopItemRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, category_id, name, path, kind, modified_at, icon_path, created_at
        FROM desktop_items
        WHERE category_id = ?1
        ORDER BY name COLLATE NOCASE ASC
        ",
    )?;

    statement
        .query_map([category_id], row_to_desktop_item)?
        .collect()
}

pub fn find_desktop_item(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<Option<DesktopItemRecord>> {
    let mut statement = conn.prepare(
        "
        SELECT id, category_id, name, path, kind, modified_at, icon_path, created_at
        FROM desktop_items
        WHERE id = ?1
        ",
    )?;

    match statement.query_row([id], row_to_desktop_item) {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error),
    }
}

fn row_to_desktop_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<DesktopItemRecord> {
    let kind: String = row.get(4)?;
    Ok(DesktopItemRecord {
        id: row.get(0)?,
        category_id: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        kind: DesktopItemKind::from_str(&kind),
        modified_at: row.get(5)?,
        icon_path: row.get(6)?,
        created_at: row.get(7)?,
    })
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
cd E:\桌面管理\src-tauri
cargo test desktop_item_crud_persists_categories_and_items
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/models.rs src-tauri/src/db.rs
git commit -m "feat: persist desktop box items"
```

---

### Task 2: 后端 Tauri 命令和路径自动分类

**Files:**
- Create: `E:\桌面管理\src-tauri\src\desktop_items.rs`
- Modify: `E:\桌面管理\src-tauri\src\main.rs`
- Test: `E:\桌面管理\src-tauri\src\desktop_items.rs`

- [ ] **Step 1: 写失败的自动分类测试**

创建 `E:\桌面管理\src-tauri\src\desktop_items.rs`，先放测试和最小类型引用：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn category_for_path_routes_default_types() {
        assert_eq!(category_for_path(Path::new(r"C:\Apps\Code.exe"), false), "software");
        assert_eq!(category_for_path(Path::new(r"C:\Users\me\Desktop\App.lnk"), false), "software");
        assert_eq!(category_for_path(Path::new(r"C:\Users\me\Desktop\方案.docx"), false), "files");
        assert_eq!(category_for_path(Path::new(r"C:\Users\me\Desktop\Work"), true), "folders");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd E:\桌面管理\src-tauri
cargo test category_for_path_routes_default_types
```

Expected: FAIL，错误包含 `category_for_path` 未定义。

- [ ] **Step 3: 实现命令模块**

在 `E:\桌面管理\src-tauri\src\desktop_items.rs` 写入：

```rust
use std::{
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{DateTime, Utc};
use tauri::State;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    db,
    error::{AppError, ErrorResponse},
    models::{DesktopCategoryRecord, DesktopItemKind, DesktopItemRecord},
};

#[tauri::command]
pub fn list_desktop_categories(
    state: State<'_, AppState>,
) -> Result<Vec<DesktopCategoryRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_desktop_categories(&conn)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn create_desktop_category(
    name: String,
    state: State<'_, AppState>,
) -> Result<DesktopCategoryRecord, ErrorResponse> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::File("分类名称不能为空".to_string()).into());
    }

    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let next_order = db::list_desktop_categories(&conn)
        .map_err(AppError::from)?
        .iter()
        .map(|category| category.sort_order)
        .max()
        .unwrap_or(2)
        + 1;
    let category = DesktopCategoryRecord {
        id: Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        sort_order: next_order,
        created_at: Utc::now().to_rfc3339(),
    };
    db::insert_desktop_category(&conn, &category).map_err(AppError::from)?;
    Ok(category)
}

#[tauri::command]
pub fn list_desktop_items(
    category_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopItemRecord>, ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    db::list_desktop_items(&conn, &category_id)
        .map_err(AppError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn add_desktop_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DesktopItemRecord>, ErrorResponse> {
    let mut items = Vec::new();
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;

    for path in paths {
        let path_buf = PathBuf::from(&path);
        if !path_buf.exists() {
            return Err(AppError::File(format!("路径不存在：{path}")).into());
        }
        let metadata = std::fs::metadata(&path_buf).map_err(AppError::from)?;
        let category_id = category_for_path(&path_buf, metadata.is_dir()).to_string();
        let kind = kind_for_category(&category_id);
        let modified_at = metadata.modified().ok().map(|time| {
            let datetime: DateTime<Utc> = time.into();
            datetime.to_rfc3339()
        });
        let name = path_buf
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&path)
            .to_string();
        let icon_path = software_icon_path(&path_buf, &state.icons_dir, &kind);
        let now = Utc::now().to_rfc3339();
        let item = DesktopItemRecord {
            id: path.clone(),
            category_id,
            name,
            path,
            kind,
            modified_at,
            icon_path,
            created_at: now,
        };
        db::insert_desktop_item(&conn, &item).map_err(AppError::from)?;
        items.push(item);
    }

    Ok(items)
}

#[tauri::command]
pub fn open_desktop_item(id: String, state: State<'_, AppState>) -> Result<(), ErrorResponse> {
    let conn = state
        .conn
        .lock()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let item = db::find_desktop_item(&conn, &id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Desktop item".to_string()))?;
    if !Path::new(&item.path).exists() {
        return Err(AppError::File(format!("路径不存在：{}", item.path)).into());
    }
    tauri_plugin_opener::open_path(&item.path, None::<&str>)
        .map_err(|error| AppError::File(error.to_string()))
        .map_err(Into::into)
}

fn category_for_path(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "folders";
    }
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension)
            if extension.eq_ignore_ascii_case("lnk")
                || extension.eq_ignore_ascii_case("exe") =>
        {
            "software"
        }
        _ => "files",
    }
}

fn kind_for_category(category_id: &str) -> DesktopItemKind {
    match category_id {
        "software" => DesktopItemKind::Software,
        "folders" => DesktopItemKind::Folder,
        _ => DesktopItemKind::File,
    }
}

fn software_icon_path(
    path: &Path,
    icons_dir: &Path,
    kind: &DesktopItemKind,
) -> Option<String> {
    if !matches!(kind, DesktopItemKind::Software) {
        return None;
    }

    let icon_path = icons_dir.join(format!(
        "{:016x}.png",
        path.to_string_lossy()
            .to_lowercase()
            .as_bytes()
            .iter()
            .fold(0xcbf29ce484222325_u64, |hash, byte| (hash ^ u64::from(*byte))
                .wrapping_mul(0x100000001b3))
    ));
    if let Some(parent) = icon_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let script = r#"
$ErrorActionPreference = 'Stop'
$SourcePath = $env:ODM_SOURCE_PATH
$IconPath = $env:ODM_ICON_PATH
$source = $SourcePath
if ([IO.Path]::GetExtension($SourcePath).Equals('.lnk', [StringComparison]::OrdinalIgnoreCase)) {
    $wsh = New-Object -ComObject WScript.Shell
    $link = $wsh.CreateShortcut($SourcePath)
    $target = [Environment]::ExpandEnvironmentVariables([string]$link.TargetPath)
    if (-not [string]::IsNullOrWhiteSpace($target) -and (Test-Path -LiteralPath $target)) {
        $source = $target
    }
}
if (-not [string]::IsNullOrWhiteSpace($source) -and (Test-Path -LiteralPath $source)) {
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source)
    if ($null -ne $icon) {
        $bitmap = $icon.ToBitmap()
        $bitmap.Save($IconPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $icon.Dispose()
    }
}
"#;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("ODM_SOURCE_PATH", path)
        .env("ODM_ICON_PATH", &icon_path)
        .output();

    if output.is_ok_and(|output| output.status.success()) && icon_path.exists() {
        Some(icon_path.to_string_lossy().into_owned())
    } else {
        None
    }
}
```

- [ ] **Step 4: 注册模块和命令**

在 `E:\桌面管理\src-tauri\src\main.rs` 加入：

```rust
mod desktop_items;
```

在 `tauri::generate_handler![]` 中加入：

```rust
desktop_items::list_desktop_categories,
desktop_items::create_desktop_category,
desktop_items::list_desktop_items,
desktop_items::add_desktop_paths,
desktop_items::open_desktop_item,
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
cd E:\桌面管理\src-tauri
cargo test category_for_path_routes_default_types
cargo test
```

Expected: 两个命令都 PASS，完整后端测试包含现有窗口、便签、快捷方式测试。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/desktop_items.rs src-tauri/src/main.rs
git commit -m "feat: add desktop item commands"
```

---

### Task 3: 前端类型、API 和失败测试

**Files:**
- Modify: `E:\桌面管理\src\types.ts`
- Modify: `E:\桌面管理\src\api.ts`
- Modify: `E:\桌面管理\src\test\App.test.tsx`

- [ ] **Step 1: 写失败的前端测试**

在 `E:\桌面管理\src\test\App.test.tsx` 添加或替换主界面相关测试：

```tsx
const categories = [
  { id: 'software', name: '软件', sort_order: 0, created_at: '2026-05-21T00:00:00Z' },
  { id: 'files', name: '文件', sort_order: 1, created_at: '2026-05-21T00:00:00Z' },
  { id: 'folders', name: '文件夹', sort_order: 2, created_at: '2026-05-21T00:00:00Z' },
];

const softwareItems = [
  {
    id: 'C:\\Apps\\Code.exe',
    category_id: 'software',
    name: 'Code.exe',
    path: 'C:\\Apps\\Code.exe',
    kind: 'software',
    modified_at: '2026-05-21T10:00:00Z',
    icon_path: null,
    created_at: '2026-05-21T10:00:00Z',
  },
];

const fileItems = [
  {
    id: 'C:\\Docs\\B方案.docx',
    category_id: 'files',
    name: 'B方案.docx',
    path: 'C:\\Docs\\B方案.docx',
    kind: 'file',
    modified_at: '2026-05-20T10:00:00Z',
    icon_path: null,
    created_at: '2026-05-21T10:00:00Z',
  },
  {
    id: 'C:\\Docs\\A方案.pdf',
    category_id: 'files',
    name: 'A方案.pdf',
    path: 'C:\\Docs\\A方案.pdf',
    kind: 'file',
    modified_at: '2026-05-21T10:00:00Z',
    icon_path: null,
    created_at: '2026-05-21T10:00:00Z',
  },
];

it('renders floating box categories and software grid', async () => {
  render(<App />);

  expect(await screen.findByRole('button', { name: '软件' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '文件夹' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新增分类' })).toBeInTheDocument();
  expect(await screen.findByText('Code.exe')).toBeInTheDocument();
});

it('renders file details and sorts by name and modified time', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(await screen.findByRole('button', { name: '文件' }));
  expect(screen.getByRole('button', { name: '文件名' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '修改时间' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '文件名' }));
  const rowsByName = screen.getAllByTestId('desktop-detail-row');
  expect(rowsByName[0]).toHaveTextContent('A方案.pdf');

  await user.click(screen.getByRole('button', { name: '修改时间' }));
  const rowsByTime = screen.getAllByTestId('desktop-detail-row');
  expect(rowsByTime[0]).toHaveTextContent('B方案.docx');
});

it('drops paths into the floating box and refreshes active category', async () => {
  const { container } = render(<App />);
  const dropZone = await screen.findByTestId('desktop-drop-zone');

  fireEvent.drop(dropZone, {
    dataTransfer: {
      files: [{ path: 'C:\\Docs\\A方案.pdf', name: 'A方案.pdf' }],
    },
  });

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('add_desktop_paths', {
      paths: ['C:\\Docs\\A方案.pdf'],
    });
  });
  expect(container.querySelector('.floating-box')).not.toBeNull();
});
```

更新 `beforeEach` 的 `invokeMock.mockImplementation`：

```tsx
if (command === 'list_desktop_categories') return categories;
if (command === 'list_desktop_items') {
  const categoryId = (args as { categoryId: string }).categoryId;
  if (categoryId === 'software') return softwareItems;
  if (categoryId === 'files') return fileItems;
  return [];
}
if (command === 'add_desktop_paths') return [];
if (command === 'open_desktop_item') return undefined;
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd E:\桌面管理
npm test -- src/test/App.test.tsx
```

Expected: FAIL，错误包含找不到“软件”分类按钮、`desktop-drop-zone` 或 invoke 封装缺失。

- [ ] **Step 3: 增加前端类型**

在 `E:\桌面管理\src\types.ts` 加入：

```ts
export type DesktopItemKind = 'software' | 'file' | 'folder';

export interface DesktopCategoryRecord {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface DesktopItemRecord {
  id: string;
  category_id: string;
  name: string;
  path: string;
  kind: DesktopItemKind;
  modified_at: string | null;
  icon_path: string | null;
  created_at: string;
}

export type SortKey = 'name' | 'modified_at';
export type SortDirection = 'asc' | 'desc';
```

- [ ] **Step 4: 增加 API 封装**

在 `E:\桌面管理\src\api.ts` 更新 import：

```ts
import type {
  DesktopCategoryRecord,
  DesktopItemRecord,
  NoteInput,
  NoteRecord,
  NoteUpdate,
  ShortcutRecord,
} from './types';
```

加入：

```ts
export function listDesktopCategories() {
  return invoke<DesktopCategoryRecord[]>('list_desktop_categories');
}

export function createDesktopCategory(name: string) {
  return invoke<DesktopCategoryRecord>('create_desktop_category', { name });
}

export function listDesktopItems(categoryId: string) {
  return invoke<DesktopItemRecord[]>('list_desktop_items', { categoryId });
}

export function addDesktopPaths(paths: string[]) {
  return invoke<DesktopItemRecord[]>('add_desktop_paths', { paths });
}

export function openDesktopItem(id: string) {
  return invoke<void>('open_desktop_item', { id });
}
```

- [ ] **Step 5: 运行测试确认仍失败于 UI**

Run:

```powershell
cd E:\桌面管理
npm test -- src/test/App.test.tsx
```

Expected: FAIL，错误集中在 UI 尚未渲染 `FloatingBox`。

- [ ] **Step 6: 提交**

```powershell
git add src/types.ts src/api.ts src/test/App.test.tsx
git commit -m "test: define floating box frontend contract"
```

---

### Task 4: 实现 FloatingBox UI 和交互

**Files:**
- Create: `E:\桌面管理\src\components\FloatingBox.tsx`
- Modify: `E:\桌面管理\src\App.tsx`
- Modify: `E:\桌面管理\src\App.css`

- [ ] **Step 1: 创建 `FloatingBox.tsx`**

写入核心组件：

```tsx
import { convertFileSrc } from '@tauri-apps/api/core';
import { Folder, FileText, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addDesktopPaths,
  createDesktopCategory,
  listDesktopCategories,
  listDesktopItems,
  openDesktopItem,
} from '../api';
import type {
  DesktopCategoryRecord,
  DesktopItemRecord,
  SortDirection,
  SortKey,
} from '../types';

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function itemIconSrc(item: DesktopItemRecord) {
  return item.icon_path ? convertFileSrc(item.icon_path) : null;
}

function compareItems(
  left: DesktopItemRecord,
  right: DesktopItemRecord,
  key: SortKey,
  direction: SortDirection,
) {
  const modifier = direction === 'asc' ? 1 : -1;
  if (key === 'modified_at') {
    return (
      (Date.parse(left.modified_at ?? '') - Date.parse(right.modified_at ?? '')) *
      modifier
    );
  }
  return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }) * modifier;
}

function pathsFromDrop(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
}

export default function FloatingBox() {
  const [categories, setCategories] = useState<DesktopCategoryRecord[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState('software');
  const [items, setItems] = useState<DesktopItemRecord[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshCategories() {
    const next = await listDesktopCategories();
    setCategories(next);
    if (!next.some((category) => category.id === activeCategoryId)) {
      setActiveCategoryId(next[0]?.id ?? 'software');
    }
  }

  async function refreshItems(categoryId = activeCategoryId) {
    setItems(await listDesktopItems(categoryId));
  }

  useEffect(() => {
    refreshCategories().catch((err) => setError(`加载分类失败：${errorMessage(err)}`));
  }, []);

  useEffect(() => {
    refreshItems().catch((err) => setError(`加载内容失败：${errorMessage(err)}`));
  }, [activeCategoryId]);

  const activeCategory = categories.find((category) => category.id === activeCategoryId);
  const isSoftware = activeCategoryId === 'software';
  const sortedItems = useMemo(
    () => [...items].sort((left, right) => compareItems(left, right, sortKey, sortDirection)),
    [items, sortDirection, sortKey],
  );

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
    setIsDraggingOver(false);
    setError(null);
    const paths = pathsFromDrop(event);
    if (paths.length === 0) {
      setError('没有读取到可添加的路径。');
      return;
    }
    try {
      await addDesktopPaths(paths);
      await refreshItems();
    } catch (err) {
      setError(`添加失败：${errorMessage(err)}`);
    }
  }

  async function handleCreateCategory() {
    const name = window.prompt('新分类名称');
    if (!name?.trim()) return;
    try {
      const category = await createDesktopCategory(name);
      await refreshCategories();
      setActiveCategoryId(category.id);
    } catch (err) {
      setError(`新建分类失败：${errorMessage(err)}`);
    }
  }

  return (
    <section
      className={`floating-box ${isDraggingOver ? 'dragging-over' : ''}`}
      data-testid="desktop-drop-zone"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <div className="category-strip" aria-label="分类">
        {categories.map((category) => (
          <button
            key={category.id}
            className={category.id === activeCategoryId ? 'category-pill active' : 'category-pill'}
            type="button"
            onClick={() => setActiveCategoryId(category.id)}
          >
            {category.name}
          </button>
        ))}
        <button
          className="category-add"
          type="button"
          aria-label="新增分类"
          title="新增分类"
          onClick={handleCreateCategory}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="drop-hint">
        <Search size={15} aria-hidden="true" />
        <span>拖入软件、文件或文件夹自动分类</span>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {isSoftware ? (
        <div className="software-grid" aria-label={activeCategory?.name ?? '软件'}>
          {sortedItems.map((item) => (
            <button
              className="software-item"
              key={item.id}
              type="button"
              onClick={() => openDesktopItem(item.id)}
            >
              {itemIconSrc(item) ? (
                <img src={itemIconSrc(item) ?? undefined} alt="" />
              ) : (
                <FileText size={24} aria-hidden="true" />
              )}
              <span>{item.name}</span>
            </button>
          ))}
        </div>
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
          {sortedItems.map((item) => (
            <button
              className="details-row"
              data-testid="desktop-detail-row"
              key={item.id}
              type="button"
              onClick={() => openDesktopItem(item.id)}
            >
              <span>
                {item.kind === 'folder' ? <Folder size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
                {item.name}
              </span>
              <time>{item.modified_at ? new Date(item.modified_at).toLocaleString() : '-'}</time>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 替换主界面渲染**

在 `E:\桌面管理\src\App.tsx` 移除主界面的 `ShortcutPanel` 和 `NotePanel` import，加入：

```tsx
import FloatingBox from './components/FloatingBox';
```

主界面返回：

```tsx
return (
  <>
    <WindowTitlebar title="桌面盒子" />
    <main className="app-shell compact-shell">
      <FloatingBox />
    </main>
  </>
);
```

- [ ] **Step 3: 写紧凑半透明样式**

在 `E:\桌面管理\src\App.css` 保留 `WindowTitlebar`、`.sr-only`、错误消息等通用样式，新增：

```css
.compact-shell {
  display: flex;
  min-height: calc(100vh - 38px);
  padding: 10px;
}

.floating-box {
  width: min(320px, calc(100vw - 20px));
  min-height: 360px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.74);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(18px);
}

.floating-box.dragging-over {
  border-color: #2563eb;
  background: rgba(219, 234, 254, 0.76);
}

.category-strip {
  display: flex;
  gap: 6px;
  align-items: center;
  overflow-x: auto;
  padding-bottom: 10px;
}

.category-pill,
.category-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  border-radius: 999px;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.78);
}

.category-pill {
  padding: 0 11px;
}

.category-pill.active {
  color: #ffffff;
  background: #111827;
}

.category-add {
  width: 28px;
  flex: 0 0 28px;
}

.drop-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px dashed rgba(100, 116, 139, 0.5);
  border-radius: 12px;
  color: #475569;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.48);
}

.software-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.software-item {
  display: grid;
  min-width: 0;
  min-height: 64px;
  place-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 12px;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.82);
}

.software-item img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.software-item span {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-list {
  display: grid;
  gap: 4px;
}

.details-header,
.details-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 98px;
  gap: 8px;
  align-items: center;
}

.details-header {
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(226, 232, 240, 0.82);
}

.details-header button {
  padding: 0;
  color: #475569;
  text-align: left;
  background: transparent;
}

.details-row {
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  color: #1f2937;
  text-align: left;
  background: rgba(255, 255, 255, 0.82);
}

.details-row span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-row time {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 运行前端测试确认通过**

Run:

```powershell
cd E:\桌面管理
npm test -- src/test/App.test.tsx
```

Expected: PASS，包含悬浮盒子、拖拽添加和排序测试。

- [ ] **Step 5: 提交**

```powershell
git add src/components/FloatingBox.tsx src/App.tsx src/App.css
git commit -m "feat: build floating desktop box"
```

---

### Task 5: 全量验证和桌面启动检查

**Files:**
- Modify only if verification reveals a specific failing file.

- [ ] **Step 1: 运行前端测试**

Run:

```powershell
cd E:\桌面管理
npm test -- src/test/App.test.tsx
```

Expected: PASS，所有 App 测试通过。

- [ ] **Step 2: 运行前端构建**

Run:

```powershell
cd E:\桌面管理
npm run build
```

Expected: PASS，`tsc && vite build` 完成，`dist/` 输出资源。

- [ ] **Step 3: 运行后端测试**

Run:

```powershell
cd E:\桌面管理\src-tauri
cargo test
```

Expected: PASS，现有后端测试和新增桌面条目测试全部通过。

- [ ] **Step 4: 启动桌面应用**

Run:

```powershell
cd E:\桌面管理
npm run tauri dev
```

Expected: 打开真实 Tauri 桌面窗口，窗口是无边框半透明小框，可拖动，拖入文件/文件夹/快捷方式后自动进入对应分类。

- [ ] **Step 5: 如果 exe 被占用，关闭旧进程后重试**

Run:

```powershell
Get-Process | Where-Object { $_.Path -like 'E:\桌面管理\*' } | Stop-Process -Force
npm run tauri dev
```

Expected: 旧进程关闭后，Tauri 桌面应用正常启动。

- [ ] **Step 6: 最终提交验证修正**

如果 Task 5 中修正了文件：

```powershell
git add <changed-files>
git commit -m "fix: verify floating desktop box"
```

如果没有修正文件，不创建空提交。

---

## Self-Review

- Spec coverage:
  - 半透明可拖动小框：Task 4 和 Task 5 覆盖。
  - 默认分类“软件、文件、文件夹”：Task 1、Task 3、Task 4 覆盖。
  - 加号新增分类：Task 2、Task 4 覆盖。
  - 拖拽自动分类：Task 2、Task 3、Task 4 覆盖。
  - 软件图标展示：Task 2 负责提取图标，Task 4 负责渲染图标。
  - 文件/文件夹详细信息和排序：Task 3、Task 4 覆盖。
  - 本地持久化：Task 1、Task 2 覆盖。
  - 错误处理：Task 2、Task 4 覆盖。
  - 验证：Task 5 覆盖。
- Plan wording scan: 未发现待补充内容。
- Type consistency:
  - 后端 `DesktopItemKind` 序列化为 `software | file | folder`，与前端 `DesktopItemKind` 一致。
  - 后端命令参数 `category_id` 在 Rust 中对应前端 invoke 参数 `categoryId`，Tauri 会按 camelCase 映射。
  - 排序键 `name | modified_at` 与 `DesktopItemRecord` 字段一致。
