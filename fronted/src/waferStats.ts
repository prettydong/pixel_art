import type { DecodedWafer } from '@pixel/contracts/wafer-data';

export type ChipFailStats = { counts: Uint32Array; total: number; zero: number; maximum: number };

/** Per-chip fail totals from the decoded wafer; shared by the summary tiles and the heatmap. */
export function chipFailStats(decoded: DecodedWafer): ChipFailStats {
  const counts = new Uint32Array(decoded.layout.chipCount);
  for (const group of decoded.groups) counts[Math.floor(group.regionIndex / decoded.layout.regionCount)] += group.positions.length;
  let total = 0; let zero = 0; let maximum = 0;
  for (const value of counts) { total += value; zero += Number(value === 0); maximum = Math.max(maximum, value); }
  return { counts, total, zero, maximum };
}
