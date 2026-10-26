export type CslRuleReading = { id: string; text: string; summary: string };
export type CslCheckResult = { violations: { rule: string; message: string; csls: number[] }[]; blocked: { csl: number; rule: string }[] };
export function normalizeCslRules(raw: unknown): CslRuleReading[];
export function normalizeCslResult(raw: unknown, total: number): CslCheckResult;
