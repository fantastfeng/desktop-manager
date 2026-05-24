# 桌面收纳

一个离线优先的 Windows 桌面整理工具。应用使用透明悬浮窗口收纳软件快捷方式、文件和文件夹，支持拖拽添加、分类管理、搜索、排序和托盘控制。

## 功能

- 透明无边框悬浮窗口，可作为桌面上的轻量收纳面板。
- 拖入快捷方式、文件或文件夹后自动归类为软件、文件或文件夹。
- 支持新建分类、分类排序、分类颜色、项目重命名、删除和移动分类。
- 软件分类支持图标网格和手动排序；文件/文件夹分类支持列表视图和按名称或修改时间排序。
- 托盘菜单支持显示/隐藏窗口、置顶、锁定位置、调整透明度、刷新列表和打开数据目录。
- 数据保存在本机 SQLite 数据库中，图标缓存也只保存在本机。

## 技术栈

- React 18
- TypeScript
- Vite
- Tauri 2
- Rust
- SQLite

## 开发环境

需要先安装：

- Node.js
- Rust stable toolchain
- Tauri 2 的 Windows 开发依赖

安装前端依赖：

```powershell
npm install
```

启动前端开发服务器：

```powershell
npm run dev
```

启动 Tauri 开发应用：

```powershell
npm run tauri -- dev
```

构建前端：

```powershell
npm run build
```

构建桌面应用：

```powershell
npm run tauri -- build
```

## 测试

运行前端测试：

```powershell
npm test
```

运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 数据和隐私

这个项目没有云同步或远程后端。应用运行时会在本机应用数据目录保存：

- 分类和项目记录
- 用户拖入的本机文件路径
- 软件图标缓存

仓库不会提交运行时数据库、图标缓存、构建产物、本机工具配置、环境变量文件或个人开发过程笔记。发布前请继续避免提交 `.env`、`.claude/`、`docs/superpowers/`、`dist/`、`node_modules/` 和 `src-tauri/target/`。

## 目录结构

```text
.
├── src/                  # React 前端
├── src/components/       # UI 组件
├── src/test/             # 前端测试
├── src-tauri/            # Tauri 和 Rust 后端
├── src-tauri/src/        # Rust 命令、数据库和桌面项目逻辑
├── package.json          # 前端脚本和依赖
└── vite.config.ts        # Vite 和测试配置
```

## 许可证

当前仓库还没有声明许可证。公开发布前请根据使用场景补充合适的 LICENSE 文件。
