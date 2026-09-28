import type { RepairBatchInput } from '@pixel/contracts';

export type RepairDraftItem = {
  architectureId: string; architectureName: string; architectureFingerprint: string;
  waferId: string; waferName: string;
};
export type RepairDraft = {
  items: RepairDraftItem[];
  submission: Pick<RepairBatchInput, 'modelId' | 'idempotencyKey'> | null;
};
export const MAX_REPAIR_ITEMS = 100;
export const draftItemKey = (item: { architectureId: string; waferId: string }) => JSON.stringify([item.architectureId, item.waferId]);
const storageKey = (taskId: string) => `pixel:repair-draft:${taskId}`;

export function readRepairDraft(taskId: string): RepairDraft {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(taskId)) ?? 'null');
    if (!value || !Array.isArray(value.items) || value.items.length > MAX_REPAIR_ITEMS) return { items: [], submission: null };
    const items: RepairDraftItem[] = value.items.filter((item: unknown): item is RepairDraftItem => !!item && typeof item === 'object'
      && ['architectureId', 'architectureName', 'architectureFingerprint', 'waferId', 'waferName'].every(key => typeof (item as Record<string, unknown>)[key] === 'string'));
    // Never replay a partially recovered request with its original idempotency key.
    const submission = items.length === value.items.length && items.length && typeof value.submission?.modelId === 'string'
      && typeof value.submission?.idempotencyKey === 'string' ? value.submission : null;
    return { items, submission };
  } catch { return { items: [], submission: null }; }
}

export function saveRepairDraft(taskId: string, draft: RepairDraft): boolean {
  try {
    localStorage.setItem(storageKey(taskId), JSON.stringify(draft));
    return true;
  } catch { return false; }
}
