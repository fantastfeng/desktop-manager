import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/App.css', 'utf8');

describe('窗口布局样式', () => {
  it('桌面收纳主体和 Tauri 窗口保持同尺寸', () => {
    expect(css).toMatch(/\.floating-window-root\s*{[^}]*width:\s*100vw;[^}]*height:\s*100vh;[^}]*padding:\s*0;/s);
    expect(css).toMatch(/\.floating-box\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  });

  it('软件图标条目使用固定高度和固定图形尺寸', () => {
    expect(css).toMatch(/\.software-item\s*{[^}]*height:\s*72px;/s);
    expect(css).toMatch(/\.software-open\s*{[^}]*height:\s*72px;[^}]*grid-template-rows:\s*32px min-content;/s);
    expect(css).toMatch(/\.software-open img,[\s\S]*\.software-open svg\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  });

  it('软件网格使用固定格子自适应列数且不拉大上下间隔', () => {
    expect(css).toMatch(/\.software-grid\s*{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*72px\);/s);
    expect(css).toMatch(/\.software-grid\s*{[^}]*grid-auto-rows:\s*72px;/s);
    expect(css).toMatch(/\.software-grid\s*{[^}]*align-content:\s*start;/s);
    expect(css).toMatch(/\.software-grid\s*{[^}]*row-gap:\s*clamp\(4px,\s*1vh,\s*8px\);/s);
  });

  it('顶部分类条自动换行且不使用横向滚动条', () => {
    expect(css).toMatch(/\.category-strip\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).not.toMatch(/\.category-strip\s*{[^}]*overflow-x:\s*auto;/s);
  });

  it('文件和文件夹列表使用固定表头和紧凑行距', () => {
    expect(css).toMatch(/\.details-list\s*{[^}]*gap:\s*3px;/s);
    expect(css).toMatch(/\.details-list\s*{[^}]*align-content:\s*start;/s);
    expect(css).toMatch(/\.details-header\s*{[^}]*height:\s*28px;/s);
    expect(css).toMatch(/\.details-open\s*{[^}]*height:\s*34px;/s);
    expect(css).toMatch(/\.details-open\s*{[^}]*padding:\s*6px 8px;/s);
  });
});
