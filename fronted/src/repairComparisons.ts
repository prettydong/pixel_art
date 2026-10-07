import type { RepairJob, RepairSummary } from '@pixel/contracts';

export type CompletedRepair = RepairJob & { summary: RepairSummary };
export type RepairResultGroup = { key: string; rows: CompletedRepair[] };
export const repairSeriesKey = (job: RepairJob) => JSON.stringify([job.architectureId, job.architectureFingerprint, job.modelId]);

/** Keep wafer input revisions separate and deduplicate completed runs per version / engine. */
export function completedRepairGroups(jobs: RepairJob[]): RepairResultGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, CompletedRepair[]>();
  const sorted = [...jobs].sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  for (const job of sorted) {
    if (job.status !== 'completed' || !job.summary) continue;
    const s = job.summary;
    const input = JSON.stringify([job.waferId, job.inputHash, job.synthetic, s.totalChips, s.totalRegions, s.initiallyGoodChips, s.initiallyGoodRegions]);
    const key = JSON.stringify([input, repairSeriesKey(job)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = groups.get(input) ?? [];
    rows.push({ ...job, summary: s }); groups.set(input, rows);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, rows: rows.sort((a, b) => b.summary.chipYield - a.summary.chipYield || b.summary.regionYield - a.summary.regionYield) }))
    .sort((a, b) => a.rows[0].waferName.localeCompare(b.rows[0].waferName, undefined, { numeric: true }) || a.key.localeCompare(b.key));
}
