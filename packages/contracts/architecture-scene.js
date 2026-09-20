import { z } from 'zod';

export const architectureSceneProtocol = 'pixel-architecture-scene/v1';
export const architectureColorTokens = ['--bg', '--panel', '--text', '--muted', '--line', '--accent', '--selected', '--data-accent', '--data-surface', '--architecture-accent', '--architecture-surface', '--repair-accent', '--repair-surface', '--danger'];
const label = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f\x7f]*$/);
const coordinate = z.number().int().min(0).max(1024);
const size = z.number().int().min(1).max(1024);
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const box = { id: key, x: coordinate, y: coordinate, width: size, height: size };
const rect = z.object({ ...box, type: z.literal('rect'), fill: key, label: label.optional() }).strict();
const divider = z.object({ ...box, type: z.literal('divider'), color: key, label }).strict();
const text = z.object({ ...box, type: z.literal('text'), text: label, color: key }).strict();
const grid = z.object({ id: key, type: z.literal('grid'), x: coordinate, y: coordinate,
  rows: z.number().int().min(1).max(64), cols: z.number().int().min(1).max(64), cellWidth: size, cellHeight: size,
  lineWidth: z.number().int().min(1).max(8), lineColor: key, fill: key, label,
}).strict();
const schema = z.object({
  protocol: z.literal(architectureSceneProtocol), architectureId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  title: label, description: z.string().trim().min(1).max(2000),
  canvas: z.object({ width: z.number().int().min(160).max(1024), height: z.number().int().min(96).max(768), background: key, physicalPixelsPerUnit: z.literal(3) }).strict(),
  font: z.object({ family: z.literal('Fusion Pixel'), size: z.literal(12), lineHeight: z.literal(16), weight: z.literal(400) }).strict(),
  palette: z.record(key, z.enum(architectureColorTokens)),
  nodes: z.array(z.discriminatedUnion('type', [rect, divider, text, grid])).max(1500),
  draw: z.object({
    file: z.literal('draw.mjs'),
    grid: z.object({ rows: z.number().int().min(1).max(1000000), cols: z.number().int().min(1).max(1000000), lineColor: key, fill: key }).strict(),
    records: z.array(z.object({ label, geometry: z.string().min(1).max(500), color: key }).strict()).max(200),
  }).strict().optional(),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(30),
}).strict();
export function validateArchitectureScene(input) {
  const scene = schema.parse(input);
  if (Object.keys(scene.palette).length > 32) throw new Error('调色板最多32项');
  const color = name => { if (!Object.hasOwn(scene.palette, name)) throw new Error(`未定义颜色：${name}`); };
  color(scene.canvas.background);
  if (!scene.draw && !scene.nodes.length) throw new Error('场景需要图元或draw函数');
  if (scene.draw) {
    if (scene.nodes.length) throw new Error('draw模式请使用draw函数绘图，nodes应为空');
    color(scene.draw.grid.lineColor); color(scene.draw.grid.fill);
    for (const record of scene.draw.records) color(record.color);
  }
  const ids = new Set();
  let cells = 0;
  for (const node of scene.nodes) {
    if (ids.has(node.id)) throw new Error(`绘图元素ID重复：${node.id}`);
    ids.add(node.id);
    const width = node.type === 'grid' ? node.cols * node.cellWidth + node.lineWidth : node.width;
    const height = node.type === 'grid' ? node.rows * node.cellHeight + node.lineWidth : node.height;
    if (node.x + width > scene.canvas.width || node.y + height > scene.canvas.height) throw new Error(`绘图元素越界：${node.id}`);
    if (node.type === 'grid') {
      color(node.lineColor); color(node.fill); cells += node.rows * node.cols;
      if (node.lineWidth >= node.cellWidth || node.lineWidth >= node.cellHeight) throw new Error(`网格线不能遮住单元：${node.id}`);
    } else {
      color(node.type === 'rect' ? node.fill : node.color);
      if (node.type === 'divider' && Math.min(width, height) > 8) throw new Error(`分割线宽度最多8格：${node.id}`);
      if (node.type === 'text' && height < 16) throw new Error(`文字需预留16格行高：${node.id}`);
    }
  }
  if (cells > 8192) throw new Error('网格单元总数最多8192；大阵列请画结构示意并注明省略');
  if (JSON.stringify(scene).length > 400000) throw new Error('绘图描述过大');
  return scene;
}
