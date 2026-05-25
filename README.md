# 桌面收纳

一个离线优先的 Windows 桌面整理工具。应用使用透明悬浮窗口收纳软件快捷方式、文件和文件夹，支持拖拽添加、分类管理、搜索、排序和托盘控制。

## 开箱即用

下载最新版 exe：

[offline-desktop-manager.exe](https://github.com/fantastfeng/desktop-manager/raw/main/release/offline-desktop-manager.exe)

- 双击即可运行，不需要安装 Node.js、Rust、Python 或其他开发环境。
- 支持 Windows 10 / Windows 11 64 位系统。
- exe 约 10.7 MB。
- 第一次运行时 Windows SmartScreen 可能提示未知发布者，点击“更多信息” -> “仍要运行”。

## 使用方法

1. 双击打开 `offline-desktop-manager.exe`。
2. 屏幕上会出现一个透明悬浮窗口。
3. 从资源管理器把快捷方式、exe、文件或文件夹拖入悬浮窗口。
4. 程序会自动分类：
   - `.lnk` / `.exe`：软件
   - 普通文件：文件
   - 文件夹：文件夹
5. 点击项目可以打开原文件、快捷方式或文件夹。
6. 右下角托盘图标可以显示/隐藏窗口、置顶、锁定位置、调整透明度、刷新和退出。

注意：请先打开程序，再把文件拖进悬浮窗口。不要把文件拖到 exe 图标本身上。

## 打不开时怎么处理

按下面顺序排查：

1. 确认系统是 Windows 10 或 Windows 11 64 位。
2. 如果双击没有窗口，先看右下角托盘区是否已经有程序图标，可能窗口被隐藏了。
3. 如果 Windows 拦截运行，在文件属性里勾选“解除锁定”，或在 SmartScreen 提示里选择“更多信息” -> “仍要运行”。
4. 如果仍然打不开，安装 Microsoft Edge WebView2 Runtime 后再运行：
   [下载 WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703)
5. 如果从压缩包里解压，先完整解压到普通文件夹，例如桌面或下载目录，再双击 exe。
6. 如果杀毒软件隔离了 exe，把它恢复并加入信任列表。

说明：大多数 Windows 11 和较新的 Windows 10 已自带或自动安装 WebView2。少数精简系统、旧系统、企业管控系统可能缺少它，需要按第 4 步补装。

## 功能

- 透明无边框悬浮窗口，可作为桌面上的轻量收纳面板。
- 拖入快捷方式、文件或文件夹后自动归类为软件、文件或文件夹。
- 支持新建分类、分类排序、分类颜色、项目重命名、删除和移动分类。
- 软件分类支持图标网格和手动排序；文件/文件夹分类支持列表视图和按名称或修改时间排序。
- 托盘菜单支持显示/隐藏窗口、置顶、锁定位置、调整透明度、刷新列表和打开数据目录。
- 数据保存在本机 SQLite 数据库中，图标缓存也只保存在本机。

## 开发环境

需要先安装：

- Node.js
- Rust stable toolchain
- Tauri 2 的 Windows 开发依赖

安装前端依赖：

```powershell
npm install
```

启动 Tauri 开发应用：

```powershell
npm run tauri -- dev
```

构建开箱即用 exe：

```powershell
npm run tauri -- build --no-bundle
```

构建 Windows 安装器：

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

## 许可证

当前仓库还没有声明许可证。公开发布前请根据使用场景补充合适的 LICENSE 文件。
