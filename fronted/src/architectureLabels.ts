import type { Text } from 'pixi.js';

// Keep coordinate labels at their actual anchors. Moving them to an arbitrary
// free position would make them point at a different row/column or segment.
export function declutterArchitectureLabels(labels: Text[], width: number, height: number) {
  const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
  const omitted: string[] = [];
  for (const label of labels) {
    if (label.destroyed || !label.visible || !label.renderable || !label.text.trim()) continue;
    // Measure after draw() returns, so its anchor/style/position changes count.
    const bounds = label.getBounds();
    const box = { left: Math.floor(bounds.minX), top: Math.floor(bounds.minY), right: Math.ceil(bounds.maxX), bottom: Math.ceil(bounds.maxY) };
    if (box.right <= 0 || box.bottom <= 0 || box.left >= width || box.top >= height) continue;
    const clipped = box.left < 2 || box.top < 2 || box.right > width - 2 || box.bottom > height - 2;
    const overlaps = occupied.some(other => box.left < other.right + 4 && box.right + 4 > other.left
      && box.top < other.bottom + 2 && box.bottom + 2 > other.top);
    if (clipped || overlaps) {
      label.visible = false;
      omitted.push(label.text);
    } else occupied.push(box);
  }
  return [...new Set(omitted)];
}
