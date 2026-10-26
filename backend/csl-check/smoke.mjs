// Loads an AI-written CSL check script and runs it on fixed selections.
// The server runs this under the Node permission model with read access to the script only.
import { normalizeCslResult, normalizeCslRules } from '../../packages/contracts/csl-check.js';

const [path, cpText] = process.argv.slice(2);
const cslPerCp = 64;
const cpCount = Number(cpText);
const report = value => { process.stdout.write(`${JSON.stringify(value)}\n`); };
try {
  if (!path || !Number.isSafeInteger(cpCount) || cpCount < 1) throw new Error('用法：smoke.mjs <csl-check.mjs> <cpCount>');
  const module = await import(new URL(path, `file://${process.cwd()}/`).href);
  if (typeof module.check !== 'function') throw new Error('检查脚本缺少 check 函数');
  const rules = normalizeCslRules(module.rules);
  const total = cpCount * cslPerCp;
  // Empty, single, every CP's first CSL, one dense CP, and a spread of evenly spaced CSLs.
  const selections = [[], [0], [total - 1], Array.from({ length: cpCount }, (_, cp) => cp * cslPerCp),
    Array.from({ length: cslPerCp }, (_, csl) => csl), Array.from({ length: Math.ceil(total / 7) }, (_, i) => i * 7)];
  const started = Date.now();
  for (const used of selections) {
    const input = () => ({ cpCount, cslPerCp, used: [...used] });
    const first = JSON.stringify(normalizeCslResult(module.check(input()), total));
    if (JSON.stringify(normalizeCslResult(module.check(input()), total)) !== first) throw new Error('检查脚本对同一选择给出不同结果');
  }
  if (Date.now() - started > 5000) throw new Error('检查脚本运行过慢');
  report({ ok: true, rules: rules.length });
} catch (error) {
  report({ ok: false, error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) });
  process.exitCode = 1;
}
