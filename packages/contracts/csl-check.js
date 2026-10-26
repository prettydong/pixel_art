// Shared by the server smoke test and the browser worker that run AI-written CSL check scripts.
// Results are untrusted: keep only well-formed, bounded fields.
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const index = (value, total) => Number.isSafeInteger(value) && value >= 0 && value < total;

/** Normalizes the script's `rules` export: its reading of each user rule. */
export function normalizeCslRules(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('检查脚本的 rules 必须是列表');
  return raw.slice(0, 200).map((rule, position) => ({
    id: text(rule?.id, 40) || `R${position + 1}`, text: text(rule?.text, 2000), summary: text(rule?.summary, 2000),
  }));
}

/** Normalizes one `check()` result for a layout with `total` CSLs. */
export function normalizeCslResult(raw, total) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.violations)) throw new Error('检查脚本返回格式无效：需要 violations 列表');
  if (raw.blocked !== undefined && !Array.isArray(raw.blocked)) throw new Error('检查脚本返回格式无效：blocked 必须是列表');
  const violations = raw.violations.slice(0, 4096).map(item => ({
    rule: text(item?.rule, 40), message: text(item?.message, 500),
    csls: Array.isArray(item?.csls) ? [...new Set(item.csls.filter(value => index(value, total)))].slice(0, total) : [],
  }));
  const blocked = new Map();
  for (const item of (raw.blocked ?? []).slice(0, total * 4)) {
    const csl = typeof item === 'number' ? item : item?.csl;
    if (index(csl, total) && !blocked.has(csl)) blocked.set(csl, typeof item === 'number' ? '' : text(item?.rule, 40));
  }
  return { violations, blocked: [...blocked].map(([csl, rule]) => ({ csl, rule })) };
}
