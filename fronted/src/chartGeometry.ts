export const colors = Array.from({ length: 12 }, (_, index) => `var(--chart-${index + 1})`);

/** Polyline paths for a series; a missing value breaks the line instead of bridging it. */
export function linePaths(values: readonly (number | null)[], x: (index: number) => number, y: (value: number) => number) {
  const paths: { d: string; start: number; end: number }[] = [];
  let d = '', start = 0, end = 0, points = 0;
  const close = () => { if (points > 1) paths.push({ d, start, end }); d = ''; points = 0; };
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === null) { close(); continue; }
    const px = x(index), py = y(value);
    if (!points) { d = `M${px} ${py}`; start = px; } else d += `L${px} ${py}`;
    end = px; points++;
  }
  close();
  return paths;
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
