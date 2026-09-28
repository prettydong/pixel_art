// Deterministic, illustrative wafer geometry and synthetic fail generator.
// This is a spatial count model, not a fit to a particular process or product.
import { encodeWafer, MAX_FAILS, MAX_OCCUPIED_REGIONS, validateWaferLayout } from './wafer-data.js';

export const MAX_MAP_CHIPS = 10_000;
export const SPATIAL_PATTERNS = Object.freeze([
  { id: 'random', label: '随机', description: '各 chip 使用相同的期望 fail 数。' },
  { id: 'center', label: '中心', description: 'fail 更集中在晶圆中心。' },
  { id: 'donut', label: '环带', description: 'fail 更集中在中间环带。' },
  { id: 'edge-ring', label: '边缘环', description: 'fail 更集中在晶圆边缘。' },
  { id: 'edge-local', label: '局部边缘', description: 'fail 更集中在一段晶圆边缘。' },
  { id: 'local', label: '局部', description: 'fail 更集中在一个局部区域。' },
  { id: 'scratch', label: '划痕', description: 'fail 更集中在一条穿过晶圆的窄带。' },
  { id: 'mixed', label: '混合', description: '确定性地组合多种空间形态。' },
]);
const PATTERN_IDS = new Set(SPATIAL_PATTERNS.map(({ id }) => id));
export const DEFAULT_FAILS_PER_REGION = 100;
// meanFails is stored per chip; omitted generation input is derived from its product layout below.
export const DEFAULT_GENERATION = Object.freeze({ pattern: 'mixed', seed: 20260926, meanFails: DEFAULT_FAILS_PER_REGION * 16, strength: 12, dispersion: 4 });

function assertNumber(value, key, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) throw new Error(`${key} 必须是 ${min}..${max} 的${integer ? '整数' : '有限数字'}`);
  return value;
}

/** Validate partial user input and return a complete serialisable option set. */
export function validateGenerationOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成参数必须是对象');
  // Metadata is accepted to support replaying a manifest entry; it is recomputed.
  for (const key of Object.keys(value)) if (!Object.hasOwn(DEFAULT_GENERATION, key) && key !== 'model' && key !== 'geometry') throw new Error(`不支持的生成参数：${key}`);
  const options = { ...DEFAULT_GENERATION, ...value };
  if (typeof options.pattern !== 'string' || !PATTERN_IDS.has(options.pattern)) throw new Error(`pattern 必须是 ${[...PATTERN_IDS].join(' / ')}`);
  return { pattern: options.pattern, seed: assertNumber(options.seed, 'seed', 0, 0xffffffff, true), meanFails: assertNumber(options.meanFails, 'meanFails', 0, MAX_FAILS), strength: assertNumber(options.strength, 'strength', 0, 30), dispersion: assertNumber(options.dispersion, 'dispersion', 0.2, 100) };
}

/** disk-grid-v1 selects K nearest lattice points and numbers them in raster order. */
export function createWaferMap(chipCount) {
  if (!Number.isSafeInteger(chipCount) || chipCount < 1 || chipCount > MAX_MAP_CHIPS) throw new Error(`chipCount 必须是 1..${MAX_MAP_CHIPS} 的整数；预览地图最多支持 ${MAX_MAP_CHIPS} 个 chip`);
  const latticeRadius = Math.ceil(Math.sqrt(chipCount / Math.PI));
  const candidates = [];
  for (let y = -latticeRadius; y <= latticeRadius; y++) for (let x = -latticeRadius; x <= latticeRadius; x++) candidates.push({ x, y, distance2: x * x + y * y });
  candidates.sort((left, right) => left.distance2 - right.distance2 || left.y - right.y || left.x - right.x);
  const selected = candidates.slice(0, chipCount).sort((left, right) => left.y - right.y || left.x - right.x);
  const scale = latticeRadius || 1;
  return { cells: selected.map((cell, chip) => ({ chip, x: cell.x + latticeRadius, y: cell.y + latticeRadius, nx: cell.x / scale, ny: cell.y / scale, radius: Math.hypot(cell.x / scale, cell.y / scale) })), width: latticeRadius * 2 + 1, height: latticeRadius * 2 + 1 };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let value = Math.imul(state ^ (state >>> 15), 1 | state); value ^= value + Math.imul(value ^ (value >>> 7), 61 | value); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };
}
function gaussian(random) { return Math.sqrt(-2 * Math.log(Math.max(random(), Number.MIN_VALUE))) * Math.cos(2 * Math.PI * random()); }
function gamma(shape, random) {
  // gamma() is scaled to mean one.  Boosting shape<1 therefore needs the
  // (shape + 1) / shape correction in addition to U^(1 / shape).
  if (shape < 1) return gamma(shape + 1, random) * ((shape + 1) / shape) * Math.pow(Math.max(random(), Number.MIN_VALUE), 1 / shape);
  const d = shape - 1 / 3; const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 100_000; attempt++) { const x = gaussian(random); const v0 = 1 + c * x; if (v0 <= 0) continue; const v = v0 * v0 * v0; const u = random(); if (u < 1 - 0.0331 * x ** 4 || Math.log(Math.max(u, Number.MIN_VALUE)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v / shape; }
  throw new Error('Gamma-Poisson 采样未在 100000 次尝试内收敛');
}
function poissonSmall(lambda, random) { const threshold = Math.exp(-lambda); let product = 1; let count = 0; do { count++; product *= Math.max(random(), Number.MIN_VALUE); } while (product > threshold); return count - 1; }
function poisson(lambda, random, remaining) {
  // An exact Poisson sum: independent chunks no larger than 20 avoid an inaccurate normal approximation.
  let total = 0; while (lambda > 0) { const part = Math.min(lambda, 20); total += poissonSmall(part, random); if (total > remaining) return total; lambda -= part; } return total;
}
function rotate(cell, angle) { const cosine = Math.cos(angle); const sine = Math.sin(angle); return { x: cell.nx * cosine - cell.ny * sine, y: cell.nx * sine + cell.ny * cosine }; }
function createSpatialField(angle, random) {
  const localAngle = random() * Math.PI * 2;
  const localRadius = Math.sqrt(random()) * 0.58;
  return { angle, local: { x: Math.cos(localAngle) * localRadius, y: Math.sin(localAngle) * localRadius }, edge: { x: Math.cos(localAngle) * 0.82, y: Math.sin(localAngle) * 0.82 }, lineAngle: random() * Math.PI * 2, lineOffset: (random() - 0.5) * 0.5 };
}
function spatialScore(cell, pattern, field) {
  const point = rotate(cell, field.angle); const radius = Math.min(1, cell.radius);
  const bump = (target, width) => Math.exp(-((point.x - target.x) ** 2 + (point.y - target.y) ** 2) / (2 * width * width));
  const scratch = Math.exp(-((point.x * Math.cos(field.lineAngle) + point.y * Math.sin(field.lineAngle) - field.lineOffset) ** 2) / (2 * 0.065 * 0.065));
  const values = { random: 0, center: 1 - radius, donut: Math.exp(-((radius - 0.56) ** 2) / (2 * 0.16 * 0.16)), 'edge-ring': radius, 'edge-local': bump(field.edge, 0.22), local: bump(field.local, 0.24), scratch };
  return pattern === 'mixed' ? (values.donut + values['edge-local'] + values.scratch) / 3 : values[pattern];
}
function uniquePositions(capacity, count, random) {
  if (count > capacity) throw new Error('chip 的 fail 数超过所有 region 的可用坐标数');
  // Floyd sampling is exactly count draws without replacement and avoids both
  // rejection loops and the visual lattice created by a fixed-step permutation.
  const selected = new Set();
  for (let index = capacity - count; index < capacity; index++) {
    const candidate = Math.floor(random() * (index + 1));
    selected.add(selected.has(candidate) ? index : candidate);
  }
  return Uint32Array.from(selected).sort();
}
function appendChipGroups(groups, chip, failCount, layout, random) {
  if (!failCount) return;
  const cellCount = layout.rows * layout.cols; const totalCapacity = cellCount * layout.regionCount;
  if (!Number.isSafeInteger(totalCapacity) || failCount > totalCapacity) throw new Error('chip 的 fail 数超过产品定义的 region 坐标总数');
  const used = Math.min(layout.regionCount, Math.max(Math.ceil(failCount / 64), Math.ceil(failCount / cellCount)));
  if (groups.length + used > MAX_OCCUPIED_REGIONS) throw new Error(`生成结果超过每片 ${MAX_OCCUPIED_REGIONS} 个非空 region 的限制`);
  const start = Math.floor(random() * layout.regionCount); const base = Math.floor(failCount / used); const extra = failCount % used;
  for (let index = 0; index < used; index++) { const count = base + (index < extra ? 1 : 0); const region = (start + index) % layout.regionCount; groups.push({ regionIndex: chip * layout.regionCount + region, positions: uniquePositions(cellCount, count, random) }); }
}

export function generateSpatialWafer(layoutInput, inputOptions = {}) {
  const layout = validateWaferLayout(layoutInput);
  if (layout.chipCount > MAX_MAP_CHIPS) throw new Error(`空间预览和生成最多支持 ${MAX_MAP_CHIPS} 个 chip`);
  const options = validateGenerationOptions(inputOptions);
  if (!Object.hasOwn(inputOptions, 'meanFails')) options.meanFails = DEFAULT_FAILS_PER_REGION * layout.regionCount;
  if (options.meanFails * layout.chipCount > MAX_FAILS) throw new Error(`目标总 fail 超过 ${MAX_FAILS}，请降低每 region 平均 fail 数`);
  const map = createWaferMap(layout.chipCount); const random = createRandom(options.seed); const field = createSpatialField(random() * Math.PI * 2, random);
  const scores = map.cells.map((cell) => spatialScore(cell, options.pattern, field)); const rawWeights = scores.map((score) => Math.exp(options.strength * score)); const normalizer = rawWeights.reduce((sum, weight) => sum + weight, 0) / rawWeights.length;
  const groups = []; const chipFails = new Uint32Array(layout.chipCount); let failCount = 0; let zeroFailChips = 0; let maxChipFails = 0;
  for (let chip = 0; chip < layout.chipCount; chip++) {
    let count = 0;
    if (options.meanFails > 0) { const lambda = options.meanFails * (rawWeights[chip] / normalizer) * gamma(options.dispersion, random); count = poisson(lambda, random, MAX_FAILS - failCount); if (count > MAX_FAILS - failCount) throw new Error(`生成结果超过每片 ${MAX_FAILS} 个 fail 的限制`); }
    chipFails[chip] = count; failCount += count; if (!count) zeroFailChips++; if (count > maxChipFails) maxChipFails = count; appendChipGroups(groups, chip, count, layout, random);
  }
  groups.sort((left, right) => left.regionIndex - right.regionIndex); const bytes = encodeWafer({ layout, groups, synthetic: true });
  return { bytes, chipFails, generation: { ...options, model: 'spatial-gamma-poisson-v2', geometry: 'disk-grid-v1' }, summary: { failCount, occupiedRegionCount: groups.length, zeroFailChips, maxChipFails } };
}
