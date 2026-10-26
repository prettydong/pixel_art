import { normalizeCslResult, normalizeCslRules } from '@pixel/contracts/csl-check';

// Runs one AI-written CSL check script off the main thread; the page terminates it on a timeout.
type Request = { type: 'load'; source: string } | { type: 'check'; id: number; cpCount: number; cslPerCp: number; used: number[] };
type CheckModule = { check: (input: { cpCount: number; cslPerCp: number; used: number[] }) => unknown; rules?: unknown };
const worker = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (value: unknown) => void } & Record<string, unknown>;
// The script only needs its input; remove network access before it loads.
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'indexedDB', 'caches', 'Worker']) {
  try { Object.defineProperty(worker, name, { value: undefined, configurable: false, writable: false }); } catch { /* Not present in this browser. */ }
}
let loaded: Promise<CheckModule> | undefined;
const message = (error: unknown) => error instanceof Error && error.message ? error.message : String(error);

worker.onmessage = event => {
  const request = event.data;
  if (request.type === 'load') {
    const url = URL.createObjectURL(new Blob([request.source], { type: 'text/javascript' }));
    loaded = (import(/* @vite-ignore */ url) as Promise<CheckModule>).finally(() => URL.revokeObjectURL(url));
    loaded.then(module => {
      if (typeof module.check !== 'function') throw new Error('检查脚本缺少 check 函数');
      worker.postMessage({ type: 'loaded', rules: normalizeCslRules(module.rules) });
    }).catch(error => worker.postMessage({ type: 'error', error: message(error) }));
    return;
  }
  if (!loaded) { worker.postMessage({ type: 'result', id: request.id, error: '检查脚本尚未载入' }); return; }
  loaded.then(module => {
    const result = normalizeCslResult(module.check({ cpCount: request.cpCount, cslPerCp: request.cslPerCp, used: [...request.used] }), request.cpCount * request.cslPerCp);
    worker.postMessage({ type: 'result', id: request.id, result });
  }).catch(error => worker.postMessage({ type: 'result', id: request.id, error: message(error) }));
};
