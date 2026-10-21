import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, lstatSync, copyFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArchitectureScene } from '../../packages/contracts/architecture-scene.js';

// This harness validates and archives the agent's drawing. `--init` writes a standard starter drawing
// from the task context; publishing never decides layout or draws pixels.
const args = process.argv.slice(2);
const has = name => args.includes(name);
const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`缺少 ${name}`); return args[i + 1]; };
const sha = data => createHash('sha256').update(data).digest('hex');

function publish(work, context, scenePath, recipePath, drawPath) {
  const artifacts = realpathSync(resolve(work, 'artifacts'));
  const safeInput = value => {
    const path = realpathSync(resolve(value)); const rel = relative(work, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep) || !statSync(path).isFile() || statSync(path).size > 1000000) throw new Error('输入必须是当前work内不超过1MB的文件');
    return path;
  };
  const input = safeInput(scenePath);
  const recipe = safeInput(recipePath);
  if (!/\.(py|js|mjs)$/.test(recipe)) throw new Error('保留生成绘图描述的Python或JavaScript脚本');
  const scene = validateArchitectureScene(JSON.parse(readFileSync(input, 'utf8')));
  const draw = scene.draw ? safeInput(drawPath ?? option('--draw')) : undefined;
  const architecture = context.architectures.find(item => item.id === scene.architectureId);
  if (!architecture || architecture.fingerprint !== scene.fingerprint) throw new Error('架构ID或指纹与本轮任务上下文不匹配');
  const css = readFileSync(fileURLToPath(new URL('../../fronted/src/styles.css', import.meta.url)), 'utf8');
  // Theme blocks: light may live on the default ':root' block with only a dark override.
  const cssBlock = selector => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  const defaultBlock = cssBlock(':root');
  const light = cssBlock(':root[data-theme="light"]') ?? defaultBlock;
  const dark = cssBlock(':root[data-theme="dark"]') ?? defaultBlock;
  const themeSnapshot = {};
  for (const token of new Set(Object.values(scene.palette))) {
    const color = block => block?.match(new RegExp(`${token}:\\s*(#[a-fA-F0-9]{6});`))?.[1];
    const colors = { light: color(light), dark: color(dark) };
    if (!colors.light || !colors.dark) throw new Error(`主题颜色缺失：${token}（这是 Harness / 主题问题，不要修改项目文件，请直接报告）`);
    themeSnapshot[token] = colors;
  }
  const output = resolve(artifacts, `architecture-preview-${randomUUID()}`);
  mkdirSync(output, { mode: 0o700 });
  if (lstatSync(output).isSymbolicLink()) throw new Error('输出目录不可为软链接');
  const bytes = JSON.stringify(scene, null, 2) + '\n';
  const recipeName = `recipe${recipe.endsWith('.py') ? '.py' : '.mjs'}`;
  writeFileSync(resolve(output, 'scene.json'), bytes, { flag: 'wx', mode: 0o600 });
  copyFileSync(recipe, resolve(output, recipeName));
  if (draw) copyFileSync(draw, resolve(output, 'draw.mjs'));
  const manifest = { draw: draw ? { name: 'draw.mjs', sha256: sha(readFileSync(draw)) } : undefined, protocol: 'pixel-architecture-preview/v1', architectureId: scene.architectureId, fingerprint: scene.fingerprint,
    taskId: context.task.id, runId: process.env.PIXEL_RUN_ID, createdAt: Date.now(),
    scene: { name: 'scene.json', sha256: sha(bytes) }, recipe: { name: recipeName, sha256: sha(readFileSync(recipe)) }, themeSnapshot,
    checks: ['schema', 'architecture-fingerprint', 'integer-grid', 'bounds', 'palette', 'unique-node-ids', 'complexity'] };
  // Written last: partial folders never become published previews.
  writeFileSync(resolve(output, 'architecture-preview.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return { status: 'published', output, canvas: scene.canvas, nodes: scene.nodes.length, manifest };
}

// Half-open row ranges per segment from the section/subsection mapping (never equal partitions).
function segmentRanges(rows, layout) {
  const segmentOf = row => Math.floor((Math.floor(row / layout.section_group_size) * layout.subsections_per_group
    + Math.floor((row % layout.section_group_size) / layout.subsection_size)) / layout.sections_per_segment);
  const firstRow = target => { let low = 0, high = rows; while (low < high) { const mid = Math.floor((low + high) / 2); if (segmentOf(mid) < target) low = mid + 1; else high = mid; } return low; };
  const count = layout.section_count / layout.sections_per_segment;
  if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error(`segment 数 ${count} 不适合标准起始绘图，请按 README 手写`);
  return Array.from({ length: count }, (_, index) => [firstRow(index), firstRow(index + 1)]);
}

function init(work, context, architectureId) {
  const architecture = context.architectures.find(item => item.id === architectureId);
  if (!architecture) throw new Error('本轮任务上下文中没有该架构 ID');
  let spec;
  try { spec = JSON.parse(architecture.description); } catch { spec = null; }
  if (spec?.kind !== 'pixel-architecture' || spec.model !== 'region-ccr' || !spec.array || !spec.device?.row_layout) throw new Error('该架构不是标准 region-ccr 定义，没有起始绘图；请按 README 手写 draw.mjs');
  const { rows, cols, coordinate_base: base = 0 } = spec.array;
  const { spare_rows: spareRows, ccr_groups_per_segment: groups, ccr_spares_per_group: capacities, row_layout: layout } = spec.device;
  const segments = segmentRanges(rows, layout);
  const params = { rows, cols, base, spareRows, groups, capacities, segments };
  const starter = readFileSync(fileURLToPath(new URL('./starter-draw.mjs', import.meta.url)), 'utf8');
  const source = starter.replace(/\/\*PARAMS\*\/[\s\S]*?\/\*END\*\//, `/*PARAMS*/ ${JSON.stringify(params)} /*END*/`);
  const transposed = rows > cols;
  const vSize = transposed ? cols : rows;
  const lengths = segments.map(([s, e]) => e - s).filter(Boolean);
  const perSegment = capacities.reduce((sum, value) => sum + value, 0);
  const scene = {
    protocol: 'pixel-architecture-scene/v1', architectureId: architecture.id, fingerprint: architecture.fingerprint,
    title: architecture.name.slice(0, 160),
    description: `${rows} row × ${cols} col，${segments.length} 个 segment（row 长度 ${Math.min(...lengths)}–${Math.max(...lengths)}，按 section/subsection 映射）；每 segment ${groups} 个 CCR 子组（原始 col % ${groups}），每组备用 col ${capacities.join('/')}；Region 共享全局备用 row ${spareRows} 条。冗余条带紧贴 main array：row 冗余在右（|），CCR col 冗余在下（—）。`.slice(0, 1000),
    canvas: { width: 960, height: 560, background: 'background', physicalPixelsPerUnit: 3 },
    font: { family: 'Fusion Pixel', size: 12, lineHeight: 16, weight: 400 },
    palette: { background: '--panel', surface: '--architecture-surface', ink: '--text', muted: '--muted', grid: '--line', accent: '--architecture-accent', repair: '--repair-accent', repairSurface: '--repair-surface' },
    nodes: [],
    draw: {
      file: 'draw.mjs',
      grid: { rows, cols, lineColor: 'grid', fill: 'background' },
      insets: { top: 44, right: 56, bottom: 48, left: Math.min(256, String(vSize - 1 + base).length * 7 + 14) },
      records: [
        { label: 'main array 与 segment 底色', geometry: `x=col 0..${cols}, y=row 0..${rows}；奇数 segment 叠加 surface 45%`, color: 'surface' },
        { label: 'segment 边界', geometry: `${segments.length - 1} 条内部边界，按真实 segment 起始 row；2 单位 accent，${transposed ? '延伸穿过下方 CCR col 条带' : '仅在 main array 内'}`, color: 'accent' },
        { label: 'main array 外框', geometry: 'row=0/' + rows + '、col=0/' + cols + '，3 单位 ink', color: 'ink' },
        { label: 'Region 共享备用 row 池', geometry: `${spareRows} 条，紧贴 main array 右边、等高、宽 32 px；竖线 | 示意，标注实际数量`, color: 'repair' },
        { label: 'CCR 备用 col', geometry: `紧贴 main array 下边、高 24 px；${transposed ? '每个 segment 一段独立条带，与 segment 屏幕范围对齐' : '一条横跨阵列的条带，代表每个 segment 的独立资源'}；横线 — 示意，每 segment ${perSegment} 条`, color: 'repair' },
        { label: '标签', geometry: 'S<index> 画在 main array 内对应 segment 上（带底色）；横轴刻度在阵列上方，纵轴刻度在左侧；12 单位文字', color: 'muted' },
      ],
    },
    assumptions: [
      `架构 ID 与 fingerprint 取自本轮任务上下文：${architecture.id}`,
      '冗余条带为容量示意，不按地址比例绘制；CCR 子组按原始 col 取模交错，未画成连续分区。',
    ],
  };
  const stem = `preview-${architecture.id.slice(0, 8)}-${Date.now()}`;
  const paths = { draw: resolve(work, `${stem}-draw.mjs`), scene: resolve(work, `${stem}-scene.json`), recipe: resolve(work, `${stem}-recipe.mjs`) };
  writeFileSync(paths.draw, source);
  writeFileSync(paths.scene, JSON.stringify(scene, null, 2) + '\n');
  writeFileSync(paths.recipe, `// Regenerates the scene metadata written by the harness --init.\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2] ?? ${JSON.stringify(paths.scene)}, ${JSON.stringify(JSON.stringify(scene, null, 2) + '\n')});\n`);
  return { status: 'initialized', ...paths, segments: segments.length, transposed };
}

try {
  const work = realpathSync(process.env.PIXEL_WORK_DIR);
  const contextPath = realpathSync(process.env.PIXEL_TASK_CONTEXT);
  if (relative(work, contextPath).startsWith('..')) throw new Error('任务上下文必须位于当前work内');
  const context = JSON.parse(readFileSync(contextPath, 'utf8'));
  if (has('--init')) {
    const result = init(work, context, option('--init'));
    console.log(JSON.stringify(has('--publish') ? { ...result, ...publish(work, context, result.scene, result.recipe, result.draw) } : result, null, 2));
  } else {
    console.log(JSON.stringify(publish(work, context, option('--scene'), option('--recipe')), null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
