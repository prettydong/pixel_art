// Read-only check: a column-first construction gives a valid repair witness
// (columns within per-pool capacity, remaining fails' distinct rows <= R).
import { readFileSync } from 'node:fs';
import { decodeWafer } from '../../../packages/contracts/wafer-data.js';
const archs = { 'R64 C2': [64, 2], 'R128 C1': [128, 1], 'R128 C2': [128, 2] };
const jobsDir = process.argv[2];
const root = new URL('../../../', import.meta.url).pathname;
import { readdirSync } from 'node:fs';
const greedy = {};
for (const id of readdirSync(jobsDir)) {
  const m = JSON.parse(readFileSync(`${jobsDir}/${id}/manifest.json`));
  const key = `${m.architecture.name.slice(8)}|${m.dataset.name}`;
  const set = new Set();
  for (const line of readFileSync(`${jobsDir}/${id}/result.jsonl`, 'utf8').split('\n')) {
    if (!line) continue; const r = JSON.parse(line);
    if (r.type === 'region' && r.status === 'repaired') set.add(r.chip * 16 + r.region);
  }
  greedy[key] = set;
}
for (const w of ['001', '002', '003']) {
  const wafer = decodeWafer(new Uint8Array(readFileSync(`${root}/backend/demos/dejoa/DEJOA-${w}.pwafer`)));
  const { cols, chipCount, regionCount } = wafer.layout;
  for (const [name, [R, C]] of Object.entries(archs)) {
    const g = greedy[`${name}|DEJOA-${w}`];
    let cf = 0, union = 0, greedyN = 0, cfOnlyNotGreedy = 0;
    const failedChip = new Set(), failedChipUnion = new Set();
    for (const { regionIndex, positions } of wafer.groups) {
      const pools = new Map();
      for (const p of positions) {
        const row = Math.floor(p / cols), col = p % cols, seg = Math.floor(row / 2048);
        const pk = seg * 8 + (col % 8), ck = seg * cols + col;
        if (!pools.has(pk)) pools.set(pk, new Map());
        const colMap = pools.get(pk);
        if (!colMap.has(ck)) colMap.set(ck, []);
        colMap.get(ck).push(row);
      }
      const rows = new Set();
      for (const colMap of pools.values()) {
        const sorted = [...colMap.values()].sort((a, b) => b.length - a.length);
        for (const rs of sorted.slice(C)) for (const r of rs) rows.add(r);
      }
      const ok = rows.size <= R, gok = g.has(regionIndex);
      if (ok) cf++; if (gok) greedyN++; if (ok || gok) union++; if (ok && !gok) cfOnlyNotGreedy++;
      const chip = Math.floor(regionIndex / regionCount);
      if (!gok) failedChip.add(chip); if (!ok && !gok) failedChipUnion.add(chip);
    }
    const good = chipCount * regionCount - wafer.groups.length;
    const n = chipCount * regionCount;
    console.log(w, name, 'greedyRegY', ((good + greedyN) / n * 100).toFixed(2), 'colFirstRegY', ((good + cf) / n * 100).toFixed(2), 'unionRegY', ((good + union) / n * 100).toFixed(2), 'greedyChip', ((chipCount - failedChip.size) / chipCount * 100).toFixed(1), 'unionChip', ((chipCount - failedChipUnion.size) / chipCount * 100).toFixed(1), 'newly', cfOnlyNotGreedy);
  }
}
