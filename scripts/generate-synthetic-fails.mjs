import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// Synthetic demonstration data, not a calibrated manufacturing fault model.
const seed = 20260920;
const size = 1024;
let state = seed >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
const specifications = [
  ['zero', 10, 0, 0],
  ['random_sparse', 20, 1, 16],
  ['random_dense', 10, 32, 128],
  ['row_concentrated', 15, 64, 192],
  ['column_concentrated', 15, 64, 192],
  ['local_cluster', 10, 48, 128],
  ['mixed', 10, 160, 320],
  ['full_row', 5, 1024, 1024],
  ['full_column', 5, 1024, 1024],
];
const samples = [];
for (const [pattern, count, min, max] of specifications) {
  for (let i = 0; i < count; i++) {
    const target = integer(min, max);
    const points = new Set();
    const anchorRow = integer(0, size - 1);
    const anchorCol = integer(0, size - 1);
    const clusterRow = integer(0, size - 16);
    const clusterCol = integer(0, size - 16);
    const add = (row, col) => points.add(row * size + col);
    if (pattern === 'full_row' || pattern === 'full_column') {
      for (let address = 0; address < size; address++) {
        add(pattern === 'full_row' ? anchorRow : address,
          pattern === 'full_column' ? anchorCol : address);
      }
    } else {
      let attempts = 0;
      while (points.size < target) {
        if (++attempts > 100000) throw new Error('Generation attempt limit exceeded');
        if (pattern === 'row_concentrated') add(anchorRow, integer(0, size - 1));
        else if (pattern === 'column_concentrated') add(integer(0, size - 1), anchorCol);
        else if (pattern === 'local_cluster') add(clusterRow + integer(0, 15), clusterCol + integer(0, 15));
        else if (pattern === 'mixed') {
          const component = integer(0, 3);
          if (component === 0) add(anchorRow, integer(0, size - 1));
          else if (component === 1) add(integer(0, size - 1), anchorCol);
          else if (component === 2) add(clusterRow + integer(0, 15), clusterCol + integer(0, 15));
          else add(integer(0, size - 1), integer(0, size - 1));
        } else add(integer(0, size - 1), integer(0, size - 1));
      }
    }
    if (points.size !== target) throw new Error('Unexpected fail count');
    const coordinates = [...points].sort((a, b) => a - b).map(value => [Math.floor(value / size), value % size]);
    for (const [row, col] of coordinates) {
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= size || col < 0 || col >= size) {
        throw new Error('Invalid coordinate');
      }
    }
    samples.push({ group: pattern, sample_id: `SYN${String(samples.length + 1).padStart(4, '0')}`, coordinates });
  }
}
const rosterRows = ['group,sample_id,fail_count,data_kind'];
const failRows = ['group,sample_id,row,col,data_kind'];
for (const sample of samples) {
  rosterRows.push(`${sample.group},${sample.sample_id},${sample.coordinates.length},synthetic`);
  for (const [row, col] of sample.coordinates) failRows.push(`${sample.group},${sample.sample_id},${row},${col},synthetic`);
}
const roster = rosterRows.join('\n') + '\n';
const fails = failRows.join('\n') + '\n';
const groups = specifications.map(([pattern, count]) => {
  const entries = samples.filter(sample => sample.group === pattern);
  const counts = entries.map(sample => sample.coordinates.length);
  return { pattern, samples: count, fail_count: counts.reduce((a, b) => a + b, 0), min: Math.min(...counts), max: Math.max(...counts) };
});
const manifest = {
  data_kind: 'synthetic', seed, generator: 'scripts/generate-synthetic-fails.mjs',
  description: 'Artificial mixed-pattern demonstration; not measured silicon data or a fitted statistical population.',
  array: { rows: size, cols: size, coordinate_base: 0 },
  samples: samples.length, zero_fail_samples: samples.filter(sample => sample.coordinates.length === 0).length,
  fail_count: failRows.length - 1,
  files: Object.fromEntries([['roster.csv', roster], ['fails.csv', fails]].map(([name, content]) => [name, {
    bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
  }])),
  groups,
  repair_configuration: null,
};
const instructions = `# 1024×1024 模拟失效数据\n\n` +
  `仅供流程演示与算法比较，不是实测数据，也不是经过校准的制造缺陷模型。\n\n` +
  `- 每个样本为独立的 1024×1024 阵列；坐标从 0 开始，范围 0～1023。\n` +
  `- 共 ${manifest.samples} 个样本，${manifest.zero_fail_samples} 个零失效样本，${manifest.fail_count} 条失效坐标。\n` +
  `- roster.csv 是完整名册，包含零失效样本；fails.csv 仅包含失效坐标，没有列出的单元为正常单元。\n` +
  `- group 表示模拟分布类型，不是物理 bank 或冗余资源组。\n` +
  `- fail_count 为精确计数；单样本内无重复坐标，所有坐标均在范围内。\n` +
  `- 固定随机种子 ${seed}；可用 node scripts/generate-synthetic-fails.mjs <新输出目录> 复现。\n` +
  `- 未设置备用行列、资源共享或修补规则，未运行求解器，未预设修复率。\n\n` +
  `## 导入\n\n同时上传 roster.csv 和 fails.csv。设置 data_kind=synthetic、rows=1024、cols=1024、坐标基准为 0。名册映射 group/sample_id/fail_count，坏点映射 group/sample_id/row/col；额外的 data_kind 列可忽略。评估前另行确认冗余配置和规则。\n\n` +
  `## 分布\n\n| 类型 | 样本数 | 总坏点 | 每样本坏点范围 |\n|---|---:|---:|---:|\n` +
  groups.map(g => `| ${g.pattern} | ${g.samples} | ${g.fail_count} | ${g.min}～${g.max} |`).join('\n') +
  `\n\nrow_concentrated / column_concentrated 为单行/单列中的部分坏点；full_row / full_column 为完整一行/一列失效。local_cluster 分布于一个 16×16 区域内；mixed 混合行、列、局部区域及随机散点，不代表真实发生比例。\n`;
const output = resolve(process.argv[2] ?? `datasets/synthetic-fails-1024x1024-seed${seed}`);
// Refuse to overwrite an existing dataset.
mkdirSync(resolve(output, '..'), { recursive: true });
mkdirSync(output);
for (const [name, content] of Object.entries({ 'roster.csv': roster, 'fails.csv': fails, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n', 'README.md': instructions })) {
  writeFileSync(join(output, name), content, { flag: 'wx' });
}
console.log(JSON.stringify({ output, samples: manifest.samples, zero_fail_samples: manifest.zero_fail_samples, fail_count: manifest.fail_count, groups }, null, 2));
