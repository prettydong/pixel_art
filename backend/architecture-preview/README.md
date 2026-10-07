# Agent draw / Pixi Architecture Preview Harness

The agent writes a **browser-executed JavaScript module, `draw.mjs`**, exporting `draw(ctx)`. The frontend injects Pixi 8, the default grid, current view, and theme colors. The internal system runs this module directly; it is not a DSL restricted to primitives. Do not generate SVG or PNG files or modify frontend source code or the database.

## Workflow for Each Run

1. Read `$PIXEL_TASK_CONTEXT`, find the requested architecture, and copy its `id` / `fingerprint`. Publish multiple architectures separately. Do not invent banks, ECC, groups, or spare resources that have not been provided.
   In this project, a region is an independent bank and the architecture type is CCR; bigSection is consistently called segment. Draw segment boundaries using the section/subsection formula in `device.row_layout`, not equal row partitions. Within each segment, CCR subgroups use original column addresses modulo the subgroup count; column addresses are not folded. A region shares a global spare-row pool (spare_rows, 128 by default), drawn at region level. Each segment has independent CCR column resources, further independent by subgroup; columns cannot borrow across segments or subgroups. See task context `repairModel.definitions` for the complete definitions.
2. Write your own `draw.mjs` in `$PIXEL_WORK_DIR`, and a separate `make_scene.py` or `.mjs` to generate scene JSON. Use new filenames each time; publishing automatically archives them under fixed filenames.
3. Row/column counts are actual dimensions, not limited by viewport size. For example, `rows:1024, cols:8192` means 1024 rows, 8192 columns, and 8,388,608 cells. The frontend's default grid clips to the view, merges grid lines when zoomed out, and shows individual cells when zoomed in. Do not replace it with an 8×8 thumbnail or create millions of objects. Supported dimensions are 1 to 1,000,000 rows/columns.
4. Publish using the command below. Fix failures and publish again. Metadata and functions are archived together without overwriting versions. Publishing validation does not execute the function and is not browser acceptance. Do not run repair solving.

```sh
"$PIXEL_NODE" "$PIXEL_ARCHITECTURE_HARNESS" --scene "$PIXEL_WORK_DIR/my-scene.json" --recipe "$PIXEL_WORK_DIR/make_scene.py" --draw "$PIXEL_WORK_DIR/my-draw.mjs"
```

## draw Interface

```js
export function draw({ PIXI, world, overlay, grid, colors, view, orientation, toScreen, boundary, text }) {
  // world: logical-coordinate layer; x=col, y=row, 1 unit=1 cell. The frontend handles zoom, pan, and axis transposition.
  // overlay: screen design-pixel layer, unaffected by zoom; for fixed-width dividers and labels.
  // grid: { rows, cols }. The default grid is already drawn; do not redraw it.
  // colors: current-theme HEX values mapped through the metadata palette, e.g. colors.ink.
  // view: { x,y,width,height,scale,gridStep,viewportWidth,viewportHeight }
  //       The first four fields remain the visible logical col/row range; scale is design pixels per cell.
  // orientation: { horizontal, vertical, transposed }, identifying actual screen axes.
  // When rows > cols, the horizontal axis is row and the vertical axis col; otherwise horizontal is col and vertical row.
  // toScreen(col,row) -> {x,y}, including axis transposition, rounded to integer screen design pixels.
  // boundary(colA,rowA,colB,rowB,kind) -> void; logical endpoints, with automatic transposition, clipping, and fixed width.
  // kind: 'segment' 2-unit accent / 'array' 3-unit body-text color / 'spare' 2-unit repair color.
  // text(string,x,y,color?) -> PIXI.Text, automatically added to overlay; 12-unit text/400/local Fusion Pixel.
  //       x,y are screen design pixels; color is HEX, not a palette key.
  text(`${grid.rows} row × ${grid.cols} col · horizontal axis ${orientation.horizontal}`, 12, 12, colors.ink);
  // Any Pixi Graphics/Container/Text API may be used directly:
  // const area = new PIXI.Graphics().rect(0,0,32,16).fill(colors.region);
  // world.addChild(area);
  // This is only an API example; do not add this rectangle to the actual drawing unless a region is defined.
}
```

`draw` is synchronous and is called again on initialization, zooming, panning, window resizing, and theme changes. Each call receives new world/overlay objects; the frontend destroys the previous frame's objects. Do not cache previous-frame Pixi objects or create persistent timers. No Pixi import is needed; use the injected `PIXI`. Create only objects needed for the current frame; clip large datasets using `view`.

Always display the larger dimension horizontally (columns are horizontal when equal). Actual rows/cols and fail coordinates remain unchanged. Do not swap world coordinates again or transpose the matrix yourself. `view.x/width` still represents the logical column range; `view.y/height` still represents the logical row range. Screen coordinates and axis labels must use `toScreen` and `orientation`. Do not hard-code fixed-row dividers as horizontal; convert both endpoints before determining direction. Put text in overlay and use `text()` to keep it upright.

Regions may use world. For dividers exactly 1 design unit wide, use `toScreen` and draw integer rectangles in overlay. Use `text()` for labels so font size does not follow world zoom. Prefer empty space above/below the viewport, avoiding the grid; use `view.viewportWidth` to decide whether to wrap. Chinese characters use 12 units each, English at most 8 units. Preserve all actual coordinates; coordinate labels must reflect the current view rather than hard-coded full-array endpoints. You choose layout/dividers/colors; the frontend provides only the basic grid and viewport.

Coordinate and Segment label sampling must account for text width, not just color-band width or grid-line spacing. Horizontally reserve text width plus 4 units; vertically allow a 16-unit line height. After axis transposition, determine spacing by actual screen direction. Do not clamp all off-view coordinate labels to canvas edges. After `draw` returns, the frontend avoids collisions using actual overlay Text bounds: earlier labels are retained; overlapping or out-of-bounds labels move into "Annotation details" below the drawing. This is recalculated on zoom, pan, and window changes. Create titles and essential legends first. Keep coordinates in place instead of moving text to change what it points to. This handling does not alter archived source or actual coordinates.

Boundaries must have clear hierarchy: ordinary grid lines use 1-unit `grid` color, Segment boundaries 2-unit `accent`, the main array's four sides 3-unit `ink`, and spare-resource outlines 2-unit `repair` (palette roles map to theme variables). Widths are fixed design pixels and must not thin with zoom. Segment boundaries extend through the main array and corresponding CCR spare area. Preserve all actual boundaries; do not draw modulo-interleaved CCR subgroups as contiguous partitions. Legends must identify boundary colors.

Prefer the frontend's `boundary()`, for example `boundary(0, segmentStartRow, grid.cols, segmentStartRow, 'segment')`. All endpoints are logical col/row coordinates; do not call `toScreen` first. Draw region fills first, boundaries next, and labels last. Drawing records must preserve actual boundary coordinates, types, and corresponding theme colors. On older frontends without this method, use the equivalent implementation below.

After calling `toScreen`, do not still draw fixed rows as horizontal rectangles or fixed columns as vertical rectangles; transposition would shrink entire dividers into small dots. Use the following orientation check to avoid misclassification when rounded endpoints coincide at low zoom:

```js
// colA === colB indicates a logical vertical line; callers provide only actual horizontal or vertical boundaries.
const a = toScreen(colA, rowA);
const b = toScreen(colB, rowB);
const vertical = colA === colB ? !orientation.transposed : orientation.transposed;
const half = Math.floor(thickness / 2);
const left = Math.max(0, vertical ? a.x - half : Math.min(a.x, b.x));
const top = Math.max(0, vertical ? Math.min(a.y, b.y) : a.y - half);
const right = Math.min(view.viewportWidth, vertical ? a.x - half + thickness : Math.max(a.x, b.x) + 1);
const bottom = Math.min(view.viewportHeight, vertical ? Math.max(a.y, b.y) + 1 : a.y - half + thickness);
if (right > left && bottom > top) lines.rect(left, top, right - left, bottom - top).fill(color);
```

## scene.json Metadata

Root-object fields are shown below. `draw` is the new function mode; `nodes` must be `[]`. Older primitive scenes without `draw` can still be displayed.

```json
{
  "protocol": "pixel-architecture-scene/v1",
  "architectureId": "UUID from context",
  "fingerprint": "64-character fingerprint from context",
  "title": "Architecture name",
  "description": "Actual dimensions and drawing conventions",
  "canvas": { "width": 640, "height": 256, "background": "background", "physicalPixelsPerUnit": 3 },
  "font": { "family": "Fusion Pixel", "size": 12, "lineHeight": 16, "weight": 400 },
  "palette": { "background": "--panel", "ink": "--text", "muted": "--muted", "grid": "--line", "accent": "--architecture-accent" },
  "nodes": [],
  "draw": {
    "file": "draw.mjs",
    "grid": { "rows": 1024, "cols": 8192, "lineColor": "grid", "fill": "background" },
    "records": [
      { "label": "Actual array", "geometry": "x=0..8192, y=0..1024; default grid lines are 1 screen unit, merged by powers of 2 when zoomed out", "color": "grid" }
    ]
  },
  "assumptions": []
}
```

The numbers above are only examples; read the actual architecture. `canvas.width` is the maximum viewport width (160..1024 design units); actual width varies with available page space. `height` is viewport height (96..768). Neither is an array dimension. The agent records the regions drawn, divider positions/widths, label sizes, and color roles in `records`; records must match the function. Each record includes `label` (up to 160 characters), `geometry` (up to 500 characters), and `color` (a palette key).

Theme variables: `--bg`, `--panel`, `--text`, `--muted`, `--line`, `--accent`, `--selected`, `--data-accent`, `--data-surface`, `--architecture-accent`, `--architecture-surface`, `--repair-accent`, `--repair-surface`, `--danger`. Use palette roles for colors rather than hard-coded colors suitable for only one theme.

1 design unit = 3×3 physical pixels. Coordinate labels and controls follow integer design units, with a 12-unit font and 16-unit line height. Actual cells naturally become smaller than one design unit when zoomed out; draw only merged grid lines then, without claiming every cell is individually distinguishable.

## Artifacts and Responsibilities

Each `artifacts/architecture-preview-<uuid>/` contains `scene.json`, `draw.mjs`, `recipe.py` or `recipe.mjs`, and `architecture-preview.json`, written last. The manifest records task/architecture/run IDs, timestamps, each file's SHA256, and a theme HEX snapshot. The Harness validates metadata, sources, color references, and versions; the server verifies hashes before providing function source to the frontend. The frontend executes `draw`, reports runtime errors, supports fit-to-view, zoom, pan, cell/coordinate navigation, and provides source viewing/downloads in drawing records.
