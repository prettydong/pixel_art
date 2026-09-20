# Agent draw / Pixi 架构预览 Harness

Agent 直接编写 **浏览器执行的 JavaScript 模块 `draw.mjs`**，导出 `draw(ctx)`。前端注入 Pixi 8、默认网格、当前视野、主题颜色。内部系统直接运行此模块，不是只允许图元的 DSL。不要生成 SVG、PNG 或修改前端源码、数据库。

## 每次流程

1. 读取 `$PIXEL_TASK_CONTEXT`，找到要求的架构，复制 `id` / `fingerprint`。多架构分别发布。不编造未提供的 Bank、ECC、分组或备用资源。
2. 在 `$PIXEL_WORK_DIR` 写自己的 `draw.mjs`，另写 `make_scene.py` 或 `.mjs` 生成场景 JSON。每次用新文件名，发布时自动归档为固定文件名。
3. 行列数是真实尺寸，不受视口尺寸限制。例如 `rows:1024, cols:8192`，表示 1024 行、8192 列，共 8,388,608 单元。前端默认网格自动裁剪到视野，远看合并格线，近看逐单元。不要用 8×8 缩略阵列代替，也不要创建几百万个对象。支持 1 到 1,000,000 行/列。
4. 用下面命令发布。失败则修复并重新发布。元数据和函数一起归档，版本不覆盖。发布校验不执行函数，也不等于浏览器验收。不执行修补求解。

```sh
"$PIXEL_NODE" "$PIXEL_ARCHITECTURE_HARNESS" --scene "$PIXEL_WORK_DIR/my-scene.json" --recipe "$PIXEL_WORK_DIR/make_scene.py" --draw "$PIXEL_WORK_DIR/my-draw.mjs"
```

## draw 接口

```js
export function draw({ PIXI, world, overlay, grid, colors, view, toScreen, text }) {
  // world: 真实坐标图层，x=列、y=行，1单位=1单元；自带缩放和平移。
  // overlay: 屏幕设计像素图层，不随缩放；用于固定宽度分割线、标签。
  // grid: { rows, cols }。默认网格已画好，不需要重新画。
  // colors: 元数据 palette 映射后的当前主题 HEX，如 colors.ink。
  // view: { x,y,width,height,scale,gridStep,viewportWidth,viewportHeight }
  //       前四项是可见区域真实坐标，scale 是每单元对应的设计像素数。
  // toScreen(col,row) -> {x,y}，四舍五入至整数屏幕设计像素。
  // text(string,x,y,color?) -> PIXI.Text，自动加入 overlay；12格字/400/本地Fusion Pixel。
  //       x,y为屏幕设计像素，颜色是HEX，不是palette的key。
  text(`${grid.rows} 行 × ${grid.cols} 列`, 12, 12, colors.ink);
  // 可直接用任意 Pixi Graphics/Container/Text 等 API：
  // const area = new PIXI.Graphics().rect(0,0,32,16).fill(colors.region);
  // world.addChild(area);
  // 这只是API示例；未定义区域时不要把这个矩形加到实际图中。
}
```

`draw` 是同步函数，初始化、缩放、拖动、调整窗口、切换主题时重新调用。每次调用获得新的 world/overlay，前一帧对象由前端销毁；不要缓存上一帧 Pixi 对象或创建常驻计时器。无需 import Pixi，使用注入的 `PIXI`。函数只创建当前一帧所需的对象；大量数据按 `view` 裁剪。

区域可用 world，精确1格宽分割线建议用 `toScreen` 后在 overlay 中画整数矩形。标签用 `text()`，不要让字号随世界缩放。尽量放在视口上下空位，避免挡住网格；根据 `view.viewportWidth` 判断是否需要分行，中文每字12格、英文最多8格。保留全部真实坐标，坐标标签应反映当前视野，不写死为全图端点。布局/分割线/颜色由你决定，前端只提供基础网格与视口。

## scene.json 元数据

根对象字段如下；`draw` 为新的函数模式，`nodes` 必须 `[]`。旧版没有 `draw` 的图元场景仍可展示。

```json
{
  "protocol": "pixel-architecture-scene/v1",
  "architectureId": "上下文中的UUID",
  "fingerprint": "上下文中的64位指纹",
  "title": "架构名称",
  "description": "真实尺寸与绘图口径",
  "canvas": { "width": 640, "height": 256, "background": "background", "physicalPixelsPerUnit": 3 },
  "font": { "family": "Fusion Pixel", "size": 12, "lineHeight": 16, "weight": 400 },
  "palette": { "background": "--panel", "ink": "--text", "muted": "--muted", "grid": "--line", "accent": "--architecture-accent" },
  "nodes": [],
  "draw": {
    "file": "draw.mjs",
    "grid": { "rows": 1024, "cols": 8192, "lineColor": "grid", "fill": "background" },
    "records": [
      { "label": "真实阵列", "geometry": "x=0..8192，y=0..1024；默认网格线1屏幕格，缩小时按2的幂合并", "color": "grid" }
    ]
  },
  "assumptions": []
}
```

以上数字仅为例子，必须读取实际架构。`canvas.width` 是视口最大宽度（160..1024设计格），实际宽度随页面可用空间变化；`height` 为视口高度（96..768）。这两个数不是阵列尺寸。`records` 由Agent记录本次画的区域、分割线位置和宽度、标签字号、颜色角色；记录应与函数一致。每个记录含 `label`（最多160字）、`geometry`（最多500字）、`color`（palette key）。

主题变量：`--bg`, `--panel`, `--text`, `--muted`, `--line`, `--accent`, `--selected`, `--data-accent`, `--data-surface`, `--architecture-accent`, `--architecture-surface`, `--repair-accent`, `--repair-surface`, `--danger`。颜色使用 palette 角色，不硬编码只适合某个主题的颜色。

1设计格=3×3物理像素；坐标标注和控件遵循整数设计格，字体12格，行高16格。缩小的真实单元自然不足一个设计格，此时只画合并后的网格线，不声称每个单元都能单独看清。

## 产物与职责

每个 `artifacts/architecture-preview-<uuid>/` 保存 `scene.json`、`draw.mjs`、`recipe.py` 或 `recipe.mjs`，以及最后写入的 `architecture-preview.json`。清单记录任务/架构/运行ID、时间、各文件SHA256、主题HEX快照。Harness 校验元数据、来源、颜色引用与版本；服务器核对哈希后把函数源码提供给前端。前端执行 `draw`，报告运行错误，提供全图、缩放、拖动、单元格和坐标定位，并在绘图记录中提供源码查看和下载。
