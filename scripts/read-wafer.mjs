#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeWafer, MAX_WAFER_BYTES } from '../packages/contracts/wafer-data.js';

// Bounded console output for people and the data-analysis agent; never changes the input.
function main() {
  const args = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === '--help') {
      console.log('node scripts/read-wafer.mjs --file file.pwafer [--chip 0 --region 0] [--limit 50]\n默认输出摘要；选择 chip 和 region 后输出前 limit 个 (row,col)，limit 为 0..1000。所有索引从 0 开始。');
      return;
    }
    if (!['--file', '--chip', '--region', '--limit'].includes(key) || Object.hasOwn(args, key)) throw new Error(`未知或重复参数 ${key}`);
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${key} 缺少值`);
    args[key] = value;
  }
  if (!args['--file']) throw new Error('需要 --file；查看 --help 获取用法');
  if (Boolean(args['--chip']) !== Boolean(args['--region'])) throw new Error('--chip 与 --region 必须同时指定');
  const file = resolve(args['--file']);
  if (statSync(file).size > MAX_WAFER_BYTES) throw new Error('文件超过 25 MiB');
  const wafer = decodeWafer(readFileSync(file));
  const result = { file, format: 'PXLWAF1', synthetic: wafer.synthetic, layout: wafer.layout, failCount: wafer.failCount,
    totalRegions: wafer.layout.chipCount * wafer.layout.regionCount, occupiedRegionCount: wafer.groups.length };
  const integer = (value, max, name) => {
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${name} 必须是 0..${max} 的整数`);
    return parsed;
  };
  const limit = integer(args['--limit'] ?? '50', 1000, 'limit');
  if (args['--chip'] !== undefined) {
    const chip = integer(args['--chip'], wafer.layout.chipCount - 1, 'chip');
    const region = integer(args['--region'], wafer.layout.regionCount - 1, 'region');
    const positions = wafer.groups.find(group => group.regionIndex === chip * wafer.layout.regionCount + region)?.positions ?? new Uint32Array();
    result.selectedRegion = { chip, region, failCount: positions.length, truncated: positions.length > limit,
      coordinates: Array.from(positions.subarray(0, limit), position => ({ row: Math.floor(position / wafer.layout.cols), col: position % wafer.layout.cols })) };
  }
  console.log(JSON.stringify(result, null, 2));
}
try { main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
