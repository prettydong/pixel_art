#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_FAILS_PER_REGION, DEFAULT_GENERATION, SPATIAL_PATTERNS, generateSpatialWafer, validateGenerationOptions } from '../packages/contracts/wafer-spatial.js';
import { validateWaferLayout } from '../packages/contracts/wafer-data.js';

const patternHelp = SPATIAL_PATTERNS.map(({ id }) => id).join(' / ');
const help = `生成可重复的空间合成 wafer fail 数据（PXLWAF1 / .pwafer）。这是统计示意，不代表 DEJOA 或其他产品的实测制造缺陷参数。

node scripts/generate-wafer-fails.mjs --out datasets/wafer-demo [选项]
  --chips 64 --regions 8 --rows 1024 --cols 1024  产品结构
  --wafers 3                 生成 wafer 数量（1..100）
  --seed 20260926            uint32 种子；每片使用可追溯的派生种子
  --pattern mixed            ${patternHelp}
  --mean-fails-per-region 100 每 region 的无条件目标均值
  --mean-fails N             可选，直接指定每 chip 均值（不可与上一参数同时指定）
  --strength 12              空间形态强度（0..30）
  --dispersion 4             Gamma-Poisson 离散度（0.2..100）
  --prefix wafer             文件名前缀（字母、数字、下划线、短横线）
  --help                     显示说明

输出 .pwafer、manifest.json 和 README.md。相同参数与种子产生相同内容；
已存在且内容相同的文件保留，任何不同内容均拒绝覆盖。空间位置统一为 disk-grid-v1。`;

function parseArgs() {
  const values = { out: 'datasets/wafer-demo', chips: '64', regions: '8', rows: '1024', cols: '1024', wafers: '3', seed: String(DEFAULT_GENERATION.seed), pattern: DEFAULT_GENERATION.pattern, 'mean-fails': '', 'mean-fails-per-region': String(DEFAULT_FAILS_PER_REGION), strength: String(DEFAULT_GENERATION.strength), dispersion: String(DEFAULT_GENERATION.dispersion), prefix: 'wafer' };
  const seen = new Set();
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--help') { process.stdout.write(`${help}\n`); return null; }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!Object.hasOwn(values, key) || seen.has(key)) throw new Error(`未知或重复参数：${arg}`);
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
    seen.add(key); values[key] = value;
  }
  const integer = (key, min, max) => {
    const value = Number(values[key]);
    if (!/^\d+$/.test(values[key]) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${key} 必须是 ${min}..${max} 的整数`);
    return value;
  };
  const decimal = (key) => { const value = Number(values[key]); if (!Number.isFinite(value)) throw new Error(`--${key} 必须是有限数字`); return value; };
  const layout = validateWaferLayout({ chipCount: integer('chips', 1, 10_000), regionCount: integer('regions', 1, 1_000_000), rows: integer('rows', 1, 1_000_000), cols: integer('cols', 1, 1_000_000) });
  if (seen.has('mean-fails') && seen.has('mean-fails-per-region')) throw new Error('请只指定每 chip 或每 region 中的一种均值');
  const generation = validateGenerationOptions({ pattern: values.pattern, seed: integer('seed', 0, 0xffffffff), meanFails: seen.has('mean-fails') ? decimal('mean-fails') : decimal('mean-fails-per-region') * layout.regionCount, strength: decimal('strength'), dispersion: decimal('dispersion') });
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(values.prefix)) throw new Error('--prefix 只支持 1..60 个字母、数字、下划线或短横线');
  return { out: resolve(values.out), layout, wafers: integer('wafers', 1, 100), generation, prefix: values.prefix };
}

function writeSameOrNew(path, data) {
  const bytes = Buffer.from(data);
  if (existsSync(path)) { if (!readFileSync(path).equals(bytes)) throw new Error(`拒绝覆盖内容不同的现有文件：${path}`); return; }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
}

function main() {
  const input = parseArgs();
  if (!input) return;
  mkdirSync(input.out, { recursive: true });
  const wafers = [];
  for (let index = 0; index < input.wafers; index++) {
    const generation = { ...input.generation, seed: (input.generation.seed + index) >>> 0 };
    const result = generateSpatialWafer(input.layout, generation);
    const name = `${input.prefix}-${String(index + 1).padStart(3, '0')}`;
    const file = `${name}.pwafer`;
    writeSameOrNew(join(input.out, file), result.bytes);
    wafers.push({ name, file, bytes: result.bytes.length, sha256: createHash('sha256').update(result.bytes).digest('hex'), generation: result.generation, ...result.summary });
  }
  const manifest = { format: 'PXLWAF1', dataKind: 'synthetic', generator: 'generate-wafer-fails/spatial-v2', geometry: 'disk-grid-v1', layout: input.layout, generation: input.generation, waferCount: input.wafers, wafers };
  writeSameOrNew(join(input.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeSameOrNew(join(input.out, 'README.md'), `# 空间合成 wafer 数据\n\n这些数据仅用于开发、演示和 UI 预览。它使用 disk-grid-v1 示意晶圆布局和 spatial-gamma-poisson-v2 统计模型，不代表 DEJOA 或其他产品的实测制造缺陷、良率或工艺参数。\n\n产品结构：每片 ${input.layout.chipCount} 个 chip，每个 chip ${input.layout.regionCount} 个 region，每个 region ${input.layout.rows} × ${input.layout.cols}。manifest.json 保存每片实际种子、生成参数、总数和 SHA-256。\n`);
  process.stdout.write(`${JSON.stringify({ output: input.out, dataKind: 'synthetic', layout: input.layout, wafers }, null, 2)}\n`);
}

try { main(); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
