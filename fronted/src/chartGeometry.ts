export const colors = Array.from({ length: 12 }, (_, index) => `var(--chart-${index + 1})`);

/** Rasterize straight segments into horizontal integer runs, with no diagonal SVG strokes. */
export function pixelLine(x0: number, y0: number, x1: number, y1: number) {
  const runs: { x: number; y: number; width: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const last = runs[runs.length - 1];
    if (last && last.y === y0 && last.x + last.width === x0) last.width++;
    else runs.push({ x: x0, y: y0, width: 1 });
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
  return runs;
}

export function axisNumber(value: number) {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  return magnitude >= 1e7 || magnitude < 0.001 ? value.toExponential(1) : String(Number(value.toPrecision(3)));
}

export function shortLabel(label: string, width: number) {
  let used = 0, result = '';
  for (const character of label) {
    used += character.codePointAt(0)! <= 127 ? 6 : 12;
    if (used > width - 12) return `${result}…`;
    result += character;
  }
  return result;
}
