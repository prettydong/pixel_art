// Standard CCR architecture drawing. `--init` copies this file and replaces the PARAMS line with the
// architecture's real values; edit freely afterwards. Layout (screen-fixed, also after transposition):
// row redundancy flush on the right as "|" strokes, CCR col redundancy flush below as "—" strokes,
// segment labels S<index> on the array, horizontal-axis ticks above, vertical-axis ticks on the left.
const PARAMS = /*PARAMS*/ { rows: 32768, cols: 2048, base: 0, spareRows: 128, groups: 8, capacities: [2, 2, 2, 2, 2, 2, 2, 2], segments: [[0, 2048]] } /*END*/;

const RIGHT = 32;   // row-redundancy strip width (CSS px)
const BOTTOM = 24;  // col-redundancy strip height (CSS px)
const STROKE_GAP = 3;
const CHAR = 7;     // approximate label character width

export function draw({ PIXI, overlay, colors, view, orientation, toScreen, boundary, text }) {
  const { rows, cols, base, spareRows, groups, capacities, segments } = PARAMS;
  const rowsHorizontal = orientation.transposed;
  const W = view.viewportWidth, H = view.viewportHeight;
  const a = toScreen(0, 0), b = toScreen(cols, rows);
  const arr = { l: Math.min(a.x, b.x), t: Math.min(a.y, b.y), r: Math.max(a.x, b.x), b: Math.max(a.y, b.y) };
  const clampX = x => Math.max(-4, Math.min(W + 4, x));
  const clampY = y => Math.max(-4, Math.min(H + 4, y));
  // Screen position of a row / col address along the axis it runs on.
  const rowAt = r => rowsHorizontal ? toScreen(0, r).x : toScreen(0, r).y;
  const colAt = c => rowsHorizontal ? toScreen(c, 0).y : toScreen(c, 0).x;
  const visibleRows = [view.y, view.y + view.height];
  const perSegment = capacities.reduce((sum, value) => sum + value, 0);

  // 1. Alternate segment shading (drawn first so lines and labels sit on top).
  const shade = new PIXI.Graphics(); overlay.addChild(shade);
  const visible = segments.map((range, index) => ({ index, start: range[0], end: range[1] }))
    .filter(s => s.end > s.start && s.end > visibleRows[0] && s.start < visibleRows[1]);
  for (const s of visible) {
    const p0 = rowAt(s.start), p1 = rowAt(s.end);
    if (s.index % 2 === 0 || p1 - p0 < 2) continue;
    if (rowsHorizontal) shade.rect(clampX(p0), clampY(arr.t), clampX(p1) - clampX(p0), clampY(arr.b) - clampY(arr.t));
    else shade.rect(clampX(arr.l), clampY(p0), clampX(arr.r) - clampX(arr.l), clampY(p1) - clampY(p0));
  }
  shade.fill({ color: colors.surface, alpha: 0.45 });

  // 2. Resource strips, flush against the array edges.
  const strips = new PIXI.Graphics(); overlay.addChild(strips);
  const strokes = new PIXI.Graphics(); overlay.addChild(strokes);
  const box = (x0, y0, x1, y1) => {
    const l = clampX(x0), t = clampY(y0), r = clampX(x1), btm = clampY(y1);
    if (r - l < 1 || btm - t < 1) return null;
    strips.rect(l, t, r - l, btm - t).fill(colors.repairSurface).stroke({ width: 2, color: colors.repair, alignment: 1 });
    return { l, t, r, b: btm };
  };
  // Row redundancy: one Region-wide pool on the right, vertical strokes "|".
  const pool = box(arr.r, arr.t, arr.r + RIGHT, arr.b);
  if (pool) {
    const n = Math.min(spareRows, Math.floor((RIGHT - 6) / STROKE_GAP));
    for (let i = 0; i < n; i++) strokes.rect(pool.l + 4 + i * STROKE_GAP, pool.t + 3, 1, Math.max(0, pool.b - pool.t - 6));
  }
  // Col redundancy: below the array, "—" strokes; one independent strip per segment when segments run horizontally.
  const strokeCount = Math.min(perSegment, Math.floor((BOTTOM - 6) / STROKE_GAP));
  const colStrip = (x0, x1) => {
    const strip = box(x0, arr.b, x1, arr.b + BOTTOM);
    if (!strip || strip.r - strip.l < 6) return;
    for (let i = 0; i < strokeCount; i++) strokes.rect(strip.l + 2, strip.t + 4 + i * STROKE_GAP, strip.r - strip.l - 4, 1);
  };
  if (rowsHorizontal) for (const s of visible) colStrip(rowAt(s.start), rowAt(s.end));
  else colStrip(arr.l, arr.r);
  strokes.fill(colors.repair);

  // 3. Boundaries: segment lines (extended through the per-segment col strips), then the array outline.
  const extend = rowsHorizontal ? BOTTOM / view.scale : 0;
  let last = -Infinity;
  for (const s of visible) {
    if (s.start === 0 || s.start < visibleRows[0]) continue;
    const p = rowAt(s.start);
    if (p - last < 3) continue;
    last = p;
    boundary(0, s.start, cols + extend, s.start, 'segment');
  }
  boundary(0, 0, cols, 0, 'array'); boundary(0, rows, cols, rows, 'array');
  boundary(0, 0, 0, rows, 'array'); boundary(cols, 0, cols, rows, 'array');

  // 4. Labels. Segment chips first, then ticks, then strip captions and the title.
  const chips = new PIXI.Graphics(); overlay.addChild(chips);
  let labelEnd = -Infinity;
  for (const s of visible) {
    const name = `S${s.index}`;
    const p0 = Math.max(rowAt(s.start), rowsHorizontal ? arr.l : arr.t, 0);
    const p1 = Math.min(rowAt(s.end), rowsHorizontal ? arr.r : arr.b, rowsHorizontal ? W : H);
    const need = rowsHorizontal ? name.length * CHAR + 8 : 18;
    if (p1 - p0 < need || p0 < labelEnd) continue;
    const label = text(name, 0, 0, colors.ink);
    const mid = (p0 + p1) / 2;
    const cross = rowsHorizontal ? (Math.max(arr.t, 0) + Math.min(arr.b, H)) / 2 : Math.max(arr.l, 0) + 6;
    const x = rowsHorizontal ? mid - label.width / 2 : cross;
    const y = rowsHorizontal ? cross - label.height / 2 : mid - label.height / 2;
    label.position.set(Math.round(x), Math.round(y));
    chips.roundRect(Math.round(x) - 4, Math.round(y) - 1, label.width + 8, label.height + 2, 4).fill({ color: colors.background, alpha: 0.85 });
    labelEnd = (rowsHorizontal ? x + label.width : y + label.height) + 6;
  }

  const niceStep = (minimum) => {
    const power = 10 ** Math.floor(Math.log10(Math.max(1, minimum)));
    return [1, 2, 5, 10].map(f => f * power).find(v => v >= minimum) ?? 10 * power;
  };
  const ticks = new PIXI.Graphics(); overlay.addChild(ticks);
  // Horizontal axis (row when rows > cols) above the array.
  const hSize = rowsHorizontal ? rows : cols;
  const hStart = rowsHorizontal ? view.y : view.x, hEnd = hStart + (rowsHorizontal ? view.height : view.width);
  const hStep = niceStep((String(hSize - 1 + base).length * CHAR + 16) / view.scale);
  for (let v = Math.ceil(hStart / hStep) * hStep; v <= Math.min(hEnd, hSize); v += hStep) {
    const x = rowsHorizontal ? rowAt(v) : colAt(v);
    if (x < arr.l - 1 || x > W) continue;
    ticks.rect(x, arr.t - 5, 1, 5);
    const label = text(String(Math.min(v, hSize - 1) + base), 0, 0, colors.muted);
    label.position.set(Math.round(Math.min(Math.max(0, x - label.width / 2), W - label.width)), Math.round(arr.t - 6 - label.height));
  }
  // Vertical axis on the left.
  const vSize = rowsHorizontal ? cols : rows;
  const vStart = rowsHorizontal ? view.x : view.y, vEnd = vStart + (rowsHorizontal ? view.width : view.height);
  const vStep = niceStep(22 / view.scale);
  for (let v = Math.ceil(vStart / vStep) * vStep; v <= Math.min(vEnd, vSize); v += vStep) {
    const y = rowsHorizontal ? colAt(v) : rowAt(v);
    if (y < arr.t - 1 || y > H) continue;
    ticks.rect(arr.l - 5, y, 5, 1);
    const label = text(String(Math.min(v, vSize - 1) + base), 0, 0, colors.muted);
    label.position.set(Math.round(arr.l - 7 - label.width), Math.round(y - label.height / 2));
  }
  ticks.fill(colors.muted);

  if (pool) {
    const caption = text(`${spareRows} spare row`, 0, 0, colors.repair);
    caption.rotation = Math.PI / 2;
    caption.position.set(Math.round(pool.r + 4 + caption.height), Math.round(pool.t + 2));
  }
  if (arr.b + BOTTOM < H) text(`CCR ${groups}×${capacities.every(c => c === capacities[0]) ? capacities[0] : `[${capacities.join(',')}]`} col / segment`, Math.max(arr.l, 2), arr.b + BOTTOM + 4, colors.repair);
  text(`${rows} row × ${cols} col · ${segments.length} segment · ${orientation.horizontal} →`, 4, 2, colors.ink);
}
