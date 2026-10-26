import { localizeMessage, getLanguage, t } from './i18n';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CSL_PER_CP, MAX_CP_COUNT, type CslRuleSet, type ModelOption } from '@pixel/contracts';
import type { CslCheckResult, CslRuleReading } from '@pixel/contracts/csl-check';
import { api, errorText } from './api';
import { DeleteArchitectureButton } from './DeleteChatButton';
import { Alert, Check, Pencil, Plus, RefreshCw, X } from './Icons';
import './ArchitectureEditor.css';
import './CslRules.css';

type Props = { taskId: string; models: ModelOption[]; modelId: string; onChat: (id: string) => void };
const PITCH = 5;
const GROUP = 16;
const GROUP_GAP = 4;
const CHECK_TIMEOUT_MS = 3000;
const mapHeight = CSL_PER_CP * PITCH + (CSL_PER_CP / GROUP - 1) * GROUP_GAP;
const lineY = (csl: number) => csl * PITCH + Math.floor(csl / GROUP) * GROUP_GAP + PITCH / 2;
function lineAt(y: number) {
  const span = GROUP * PITCH + GROUP_GAP;
  const group = Math.max(0, Math.min(CSL_PER_CP / GROUP - 1, Math.floor(y / span)));
  return group * GROUP + Math.max(0, Math.min(GROUP - 1, Math.floor((y - group * span) / PITCH)));
}
const lineName = (index: number) => `CP${Math.floor(index / CSL_PER_CP)} CSL${index % CSL_PER_CP}`;

/** "0-3, 17" style ranges of global CSL (col) indices. */
function formatSelection(used: number[]) {
  const parts: string[] = [];
  for (let i = 0; i < used.length; i++) {
    let end = i;
    while (end + 1 < used.length && used[end + 1] === used[end] + 1) end++;
    parts.push(end > i ? `${used[i]}-${used[end]}` : `${used[i]}`);
    i = end;
  }
  return parts.join(', ');
}
/** Accepts col indices and ranges ("17", "0-3") or per-CP forms ("CP2:5", "CP2:5-9"). */
function parseSelection(text: string, total: number): number[] | null {
  const result = new Set<number>();
  for (const token of text.split(/[\s,;，、]+/).filter(Boolean)) {
    const match = /^(?:cp(\d+):)?(\d+)(?:-(\d+))?$/i.exec(token);
    if (!match) return null;
    const base = match[1] === undefined ? 0 : Number(match[1]) * CSL_PER_CP;
    const start = Number(match[2]); const end = match[3] === undefined ? start : Number(match[3]);
    if (end < start || (match[1] !== undefined && end >= CSL_PER_CP) || base + end >= total) return null;
    for (let value = start; value <= end; value++) result.add(base + value);
  }
  return [...result].sort((a, b) => a - b);
}

type CheckerState = { status: 'idle' | 'loading' | 'ready' | 'error'; rules: CslRuleReading[]; error: string };
/** Loads one check script into its own worker; a script that hangs is stopped and reported. */
function useChecker(source: string | null) {
  const [state, setState] = useState<CheckerState>({ status: 'idle', rules: [], error: '' });
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: (value: CslCheckResult) => void; reject: (error: Error) => void; timer: number }>());
  const sequence = useRef(0);
  useEffect(() => {
    const requests = pending.current;
    if (!source) { setState({ status: 'idle', rules: [], error: '' }); return; }
    setState({ status: 'loading', rules: [], error: '' });
    const worker = new Worker(new URL('./cslCheck.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const loadTimer = window.setTimeout(() => { worker.terminate(); setState({ status: 'error', rules: [], error: t("检查脚本载入超时") }); }, CHECK_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<{ type: string; id?: number; rules?: CslRuleReading[]; result?: CslCheckResult; error?: string }>) => {
      const data = event.data;
      if (data.type === 'loaded') { clearTimeout(loadTimer); setState({ status: 'ready', rules: data.rules ?? [], error: '' }); }
      else if (data.type === 'error') { clearTimeout(loadTimer); setState({ status: 'error', rules: [], error: data.error ?? '' }); }
      else if (data.type === 'result' && data.id !== undefined) {
        const request = requests.get(data.id); if (!request) return;
        requests.delete(data.id); clearTimeout(request.timer);
        if (data.result) request.resolve(data.result); else request.reject(new Error(data.error || t("检查脚本运行失败")));
      }
    };
    worker.onerror = event => { event.preventDefault(); clearTimeout(loadTimer); setState({ status: 'error', rules: [], error: event.message || t("检查脚本运行失败") }); };
    worker.postMessage({ type: 'load', source });
    return () => {
      clearTimeout(loadTimer); worker.terminate(); workerRef.current = null;
      for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('cancelled')); }
      requests.clear();
    };
  }, [source]);
  const check = useCallback((cpCount: number, used: number[]) => new Promise<CslCheckResult>((resolve, reject) => {
    const worker = workerRef.current;
    if (!worker) { reject(new Error('cancelled')); return; }
    const id = ++sequence.current;
    const timer = window.setTimeout(() => {
      pending.current.delete(id); worker.terminate(); workerRef.current = null;
      setState(previous => ({ ...previous, status: 'error', error: t("检查脚本运行超时（超过 {0} 秒）", CHECK_TIMEOUT_MS / 1000) }));
      reject(new Error('timeout'));
    }, CHECK_TIMEOUT_MS);
    pending.current.set(id, { resolve, reject, timer });
    worker.postMessage({ type: 'check', id, cpCount, cslPerCp: CSL_PER_CP, used });
  }), []);
  return { ...state, check };
}

export function CslRules({ taskId, models, modelId, onChat }: Props) {
  const [items, setItems] = useState<CslRuleSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<CslRuleSet | 'new' | null>(null);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const anyCoding = items.some(item => item.checker?.status === 'coding');
  useEffect(() => {
    let alive = true;
    api<{ items: CslRuleSet[] }>(`/tasks/${taskId}/csl-rules`).then(result => {
      if (!alive) return;
      // Keep local selections that have not been saved yet.
      setItems(previous => result.items.map(item => ({ ...item, used: previous.find(old => old.id === item.id && old.updatedAt > item.updatedAt)?.used ?? item.used })));
      setError('');
    }).catch(err => { if (alive) setError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [taskId, reload]);
  useEffect(() => {
    if (!anyCoding) return;
    const timer = window.setTimeout(() => setReload(value => value + 1), 2000);
    return () => clearTimeout(timer);
  }, [anyCoding, items]);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const replace = (next: CslRuleSet) => setItems(previous => previous.some(item => item.id === next.id) ? previous.map(item => item.id === next.id ? next : item) : [...previous, next]);
  async function action(work: () => Promise<void>) {
    if (pending) return; setPending(true); setError('');
    try { await work(); } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return <div className="csl-rules">
    {error && <div className="workspace-error" role="alert">{localizeMessage(error)}<button onClick={() => { setError(''); setReload(value => value + 1); }}>{t("重新读取")}</button></div>}
    {!editing && <div className="panel-actions csl-rule-tabs">
      {items.length > 1 && <div className="architecture-editor-mode" role="group" aria-label={t("CSL 规则集")}>
        {items.map(item => <button type="button" key={item.id} className={item.id === selected?.id ? 'selected' : ''} aria-pressed={item.id === selected?.id} onClick={() => setSelectedId(item.id)}>{item.name}</button>)}
      </div>}
      <button className="action-button" disabled={pending} onClick={() => setEditing('new')}><Plus />{t("新建规则集")}</button>
    </div>}
    {editing && <CslRuleEditor initial={editing === 'new' ? undefined : editing} pending={pending} onCancel={() => setEditing(null)} onSave={input => action(async () => {
      const result = editing === 'new'
        ? await api<CslRuleSet>(`/tasks/${taskId}/csl-rules`, { method: 'POST', body: JSON.stringify(input) })
        : await api<CslRuleSet>(`/tasks/${taskId}/csl-rules/${editing.id}`, { method: 'PATCH', body: JSON.stringify(input) });
      replace(result); setSelectedId(result.id); setEditing(null);
    })} />}
    {!editing && !loading && !items.length && <p className="task-empty">{t("暂无 CSL 规则")}</p>}
    {!editing && selected && <CslRuleView key={selected.id} taskId={taskId} ruleSet={selected} models={models} modelId={modelId} pending={pending} onChat={onChat}
      onChanged={replace} onError={setError} onEdit={() => setEditing(selected)}
      onDelete={() => void action(async () => { await api(`/tasks/${taskId}/csl-rules/${selected.id}`, { method: 'DELETE' }); setItems(previous => previous.filter(item => item.id !== selected.id)); })} />}
  </div>;
}

function CslRuleEditor({ initial, pending, onSave, onCancel }: { initial?: CslRuleSet; pending: boolean; onSave: (input: { name: string; cpCount: number; rules: string }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? t("CSL 规则"));
  const [cpCount, setCpCount] = useState(String(initial?.cpCount ?? 16));
  const [rules, setRules] = useState(initial?.rules ?? '');
  const [error, setError] = useState('');
  const count = Number(cpCount);
  const countValid = /^\d+$/.test(cpCount) && count >= 1 && count <= MAX_CP_COUNT;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!countValid) { setError(t("CP 数量必须是 1–{0} 的整数", MAX_CP_COUNT)); return; }
    if (!name.trim() || !rules.trim()) return;
    void onSave({ name: name.trim(), cpCount: count, rules: rules.trim() });
  }
  return <form className="architecture-editor csl-rule-editor" onSubmit={submit} aria-busy={pending}>
    <div className="architecture-editor-heading"><h2>{initial ? t("编辑 CSL 规则") : t("新建 CSL 规则")}</h2></div>
    <div className="architecture-editor-basics">
      <label className="architecture-editor-field"><span className="architecture-field-label">{t("名称")}</span>
        <input required maxLength={120} value={name} disabled={pending} onChange={event => setName(event.target.value)} />
      </label>
      <label className="architecture-editor-field"><span className="architecture-field-label">{t("CP 数量")}</span>
        <input required inputMode="numeric" value={cpCount} disabled={pending} aria-invalid={!countValid} onChange={event => { setCpCount(event.target.value); setError(''); }} />
      </label>
    </div>
    <p className="task-note">{countValid ? t("{0} CP × {1} CSL = {2} col", count, CSL_PER_CP, count * CSL_PER_CP) : t("每个 CP 有 {0} 条 CSL，每条 CSL 对应 1 个 col", CSL_PER_CP)}</p>
    <label className="architecture-editor-field"><span className="architecture-field-label">{t("规则")}</span>
      <textarea required rows={8} maxLength={20000} value={rules} disabled={pending} onChange={event => setRules(event.target.value)} placeholder={t("例如：同一 CP 中 CSL n 已使用时，CSL n+32 不能使用。")} />
    </label>
    {initial?.checker && (rules.trim() !== initial.rules || count !== initial.cpCount) && <p className="task-note">{t("修改规则或 CP 数量后需要重新生成检查脚本。")}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="panel-actions"><button className="action-button primary" disabled={pending || !countValid || !name.trim() || !rules.trim()}>{pending ? t("正在保存…") : t("保存")}</button><button className="action-button" type="button" disabled={pending} onClick={onCancel}>{t("取消")}</button></div>
  </form>;
}

type ViewProps = { taskId: string; ruleSet: CslRuleSet; models: ModelOption[]; modelId: string; pending: boolean; onChat: (id: string) => void; onChanged: (next: CslRuleSet) => void; onError: (message: string) => void; onEdit: () => void; onDelete: () => void };
function CslRuleView({ taskId, ruleSet, models, modelId, pending, onChat, onChanged, onError, onEdit, onDelete }: ViewProps) {
  const total = ruleSet.cpCount * CSL_PER_CP;
  const checker = ruleSet.checker;
  const current = checker?.status === 'ready' && checker.fingerprint === ruleSet.fingerprint ? checker : null;
  const stale = !!checker && checker.fingerprint !== ruleSet.fingerprint;
  const runner = useChecker(current?.source ?? null);
  const [engine, setEngine] = useState(modelId);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<CslCheckResult | null>(null);
  const [checkError, setCheckError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const used = ruleSet.used;
  useEffect(() => { setEngine(previous => models.some(item => item.id === previous) ? previous : modelId); }, [modelId, models]);

  // Save the plan shortly after the last change; flush on leaving the page.
  const saveTimer = useRef<number | undefined>(undefined);
  const unsaved = useRef<number[] | null>(null);
  const save = useCallback((keepalive = false) => {
    const next = unsaved.current; if (!next) return;
    unsaved.current = null;
    api<CslRuleSet>(`/tasks/${taskId}/csl-rules/${ruleSet.id}`, { method: 'PATCH', body: JSON.stringify({ used: next }), keepalive })
      .then(() => setSaveError('')).catch(err => { if (!keepalive) setSaveError(errorText(err)); });
  }, [taskId, ruleSet.id]);
  useEffect(() => () => { clearTimeout(saveTimer.current); save(true); }, [save]);
  const setUsed = useCallback((next: number[]) => {
    onChanged({ ...ruleSet, used: next, updatedAt: Date.now() });
    unsaved.current = next; clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), 600);
  }, [onChanged, ruleSet, save]);

  useEffect(() => {
    if (runner.status !== 'ready') { setResult(null); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      runner.check(ruleSet.cpCount, used).then(value => { if (alive) { setResult(value); setCheckError(''); } })
        .catch((err: Error) => { if (alive && err.message !== 'cancelled' && err.message !== 'timeout') { setResult(null); setCheckError(localizeMessage(err.message)); } });
    }, 60);
    return () => { alive = false; clearTimeout(timer); };
  }, [runner.status, runner.check, ruleSet.cpCount, used]);

  const usedSet = useMemo(() => new Set(used), [used]);
  const violating = useMemo(() => new Map((result?.violations ?? []).flatMap(item => item.csls.filter(csl => usedSet.has(csl)).map(csl => [csl, item.rule] as const))), [result, usedSet]);
  const blocked = useMemo(() => new Map((result?.blocked ?? []).filter(item => !usedSet.has(item.csl)).map(item => [item.csl, item.rule] as const)), [result, usedSet]);
  const rulesById = useMemo(() => new Map(runner.rules.map(rule => [rule.id, rule])), [runner.rules]);

  async function generate() {
    if (starting) return; setStarting(true); onError('');
    try { onChanged(await api<CslRuleSet>(`/tasks/${taskId}/csl-rules/${ruleSet.id}/checker`, { method: 'POST', body: JSON.stringify({ modelId: engine, language: getLanguage() }) })); }
    catch (err) { onError(errorText(err)); } finally { setStarting(false); }
  }
  const coding = checker?.status === 'coding' || starting;
  const hoverText = hover === null ? '' : [
    `${lineName(hover)} · col ${hover}`,
    usedSet.has(hover) ? (violating.has(hover) ? t("违反 {0}", violating.get(hover) || t("规则")) : t("已使用")) : blocked.has(hover) ? t("不可使用（{0}）", blocked.get(hover) || t("规则")) : t("未使用"),
  ].join(' · ');

  return <section className="csl-rule-view" aria-label={ruleSet.name}>
    <div className="csl-rule-heading">
      <h2>{ruleSet.name}</h2>
      <span className="task-note">{t("{0} CP × {1} CSL = {2} col", ruleSet.cpCount, CSL_PER_CP, total)}</span>
      <div className="panel-actions">
        <button className="icon-button" aria-label={t("{0}：{1}", t("编辑"), ruleSet.name)} title={t("编辑")} disabled={pending} onClick={onEdit}><Pencil /></button>
        <DeleteArchitectureButton kind="rules" name={ruleSet.name} disabled={pending} onDelete={onDelete} />
      </div>
    </div>
    <details className="csl-rule-text" open={!current}><summary>{t("规则原文")}</summary><p>{ruleSet.rules}</p></details>

    <div className="csl-checker">
      <div className="csl-checker-status" role="status">
        {coding ? <><RefreshCw className="is-spinning" /><span>{t("AI 正在编写检查脚本…")}</span></>
          : stale ? <><Alert /><span>{t("规则或 CP 数量已修改，需要重新生成检查脚本")}</span></>
          : checker?.status === 'failed' ? <><Alert /><span className="error-text">{localizeMessage(checker.error ?? '') || t("检查脚本生成失败")}</span></>
          : runner.status === 'error' ? <><Alert /><span className="error-text">{t("检查脚本无法运行：{0}", localizeMessage(runner.error))}</span></>
          : current ? <><Check /><span>{t("检查脚本已就绪")}</span></>
          : <span>{t("尚无检查脚本")}</span>}
      </div>
      <div className="panel-actions">
        {checker?.conversationId && <button className="action-button" onClick={() => onChat(checker.conversationId!)}>{t("打开聊天")}</button>}
        <label className="csl-engine">{t("AI 模型")}<select value={engine} disabled={coding} onChange={event => setEngine(event.target.value)}>{!models.length && <option value="">{t("尚未配置模型")}</option>}{models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <button className="action-button primary" disabled={coding || !models.some(item => item.id === engine)} onClick={() => void generate()}>{coding ? t("正在生成…") : checker ? t("重新生成检查脚本") : t("生成检查脚本")}</button>
      </div>
    </div>

    {current && runner.status === 'ready' && <details className="csl-rule-reading"><summary>{t("AI 对规则的理解（{0} 条）", runner.rules.length)}</summary>
      {runner.rules.length ? <ol>{runner.rules.map(rule => <li key={rule.id}><strong>{rule.id}</strong> {rule.text && <span>{rule.text}</span>}{rule.summary && <p className="task-note">{rule.summary}</p>}</li>)}</ol> : <p className="task-note">{t("脚本未列出规则")}</p>}
      <details><summary>{t("查看检查脚本")}</summary><pre className="csl-source"><code>{current.source}</code></pre></details>
    </details>}

    <SelectionBar total={total} used={used} disabled={false} onChange={setUsed} />
    {saveError && <p className="error-text" role="alert">{t("使用情况未保存：{0}", localizeMessage(saveError))}</p>}
    <div className="csl-legend" aria-hidden="true">
      <span><i className="csl-swatch is-used" />{t("已使用")}</span>
      {current && <><span><i className="csl-swatch is-violation" />{t("违反规则")}</span><span><i className="csl-swatch is-blocked" />{t("不可使用")}</span></>}
      <span className="csl-hover">{hoverText}</span>
    </div>
    <CslLineMap cpCount={ruleSet.cpCount} used={usedSet} violating={violating} blocked={blocked} onChange={setUsed} onHover={setHover} />

    {current && <div className="csl-result" aria-live="polite">
      {checkError ? <p className="error-text">{t("检查失败：{0}", checkError)}</p>
        : !result ? <p className="task-note">{t("正在检查…")}</p>
        : !result.violations.length ? <p className="csl-result-ok"><Check />{t("符合全部规则")}{blocked.size > 0 && <span className="task-note"> · {t("{0} 个 col 因已选方案不可再使用", blocked.size)}</span>}</p>
        : <>
          <p className="csl-result-bad"><X />{t("{0} 处违反规则", result.violations.length)}{blocked.size > 0 && <span className="task-note"> · {t("{0} 个 col 因已选方案不可再使用", blocked.size)}</span>}</p>
          <ul className="csl-violations">{result.violations.slice(0, 200).map((item, index) => <li key={index}>
            <strong>{item.rule || t("规则")}</strong> <span>{item.message || item.csls.map(lineName).join(', ')}</span>
            {rulesById.get(item.rule)?.text && <span className="task-note"> · {rulesById.get(item.rule)!.text}</span>}
          </li>)}</ul>
          {result.violations.length > 200 && <p className="task-note">{t("仅显示前 200 处")}</p>}
        </>}
    </div>}
  </section>;
}

function SelectionBar({ total, used, disabled, onChange }: { total: number; used: number[]; disabled: boolean; onChange: (next: number[]) => void }) {
  const formatted = formatSelection(used);
  const [draft, setDraft] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setDraft(formatted); setInvalid(false); } }, [formatted]);
  function apply() {
    const next = parseSelection(draft, total);
    if (!next) { setInvalid(true); return; }
    setInvalid(false); if (formatSelection(next) !== formatted) onChange(next); setDraft(formatSelection(next));
  }
  return <div className="csl-selection">
    <label className="architecture-editor-field"><span className="architecture-field-label">{t("已使用 col（{0}/{1}）", used.length, total)}</span>
      <input value={draft} disabled={disabled} aria-invalid={invalid} placeholder={t("例如 0-3, 70, CP2:5-9")} onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; apply(); }} onChange={event => { setDraft(event.target.value); setInvalid(false); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    </label>
    <button className="action-button" type="button" disabled={disabled || !used.length} onClick={() => onChange([])}>{t("全部清除")}</button>
    {invalid && <p className="error-text" role="alert">{t("无法识别：请输入 0–{0} 的 col 编号或范围，或 CP 编号:CSL", total - 1)}</p>}
  </div>;
}

type MapProps = { cpCount: number; used: Set<number>; violating: Map<number, string>; blocked: Map<number, string>; onChange: (next: number[]) => void; onHover: (index: number | null) => void };
/** One block per CP with its CSLs drawn as horizontal lines; click or drag to mark lines used. */
function CslLineMap({ cpCount, used, violating, blocked, onChange, onHover }: MapProps) {
  const drag = useRef<{ adding: boolean; next: Set<number>; last: number } | null>(null);
  const latest = useRef({ used, onChange });
  latest.current = { used, onChange };
  useEffect(() => {
    const end = () => { drag.current = null; };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, []);
  const paint = useCallback((index: number, start: boolean) => {
    if (start) drag.current = { adding: !latest.current.used.has(index), next: new Set(latest.current.used), last: -1 };
    const state = drag.current;
    if (!state || state.last === index) return;
    state.last = index;
    if (state.adding) state.next.add(index); else state.next.delete(index);
    latest.current.onChange([...state.next].sort((a, b) => a - b));
  }, []);
  // Per-CP state strings let unchanged CP blocks skip rendering.
  const states = Array.from({ length: cpCount }, (_, cp) => {
    let value = '';
    for (let csl = 0; csl < CSL_PER_CP; csl++) {
      const index = cp * CSL_PER_CP + csl;
      value += used.has(index) ? (violating.has(index) ? 'v' : 'u') : blocked.has(index) ? 'b' : '.';
    }
    return value;
  });
  return <div className="csl-map" onPointerLeave={() => onHover(null)}>
    {states.map((value, cp) => <CpBlock key={cp} cp={cp} states={value} paint={paint} onHover={onHover} />)}
  </div>;
}

const lineClass: Record<string, string> = { u: 'is-used', v: 'is-violation', b: 'is-blocked', '.': '' };
const CpBlock = memo(function CpBlock({ cp, states, paint, onHover }: { cp: number; states: string; paint: (index: number, start: boolean) => void; onHover: (index: number | null) => void }) {
  const index = (event: ReactPointerEvent<SVGSVGElement>) => cp * CSL_PER_CP + lineAt(event.clientY - event.currentTarget.getBoundingClientRect().top);
  const usedCount = [...states].filter(value => value === 'u' || value === 'v').length;
  return <div className="csl-cp">
    <div className="csl-cp-label"><span>CP{cp}</span>{usedCount > 0 && <span className="task-note">{usedCount}</span>}</div>
    <svg width="100%" height={mapHeight} viewBox={`0 0 100 ${mapHeight}`} preserveAspectRatio="none" role="img" aria-label={t("CP{0}：已使用 {1} 条 CSL", cp, usedCount)}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); paint(index(event), true); }}
      onPointerMove={event => { const at = index(event); onHover(at); if (event.buttons & 1) paint(at, false); }}>
      {[...states].map((state, csl) => <line key={csl} className={`csl-line ${lineClass[state]}`} x1={6} x2={94} y1={lineY(csl)} y2={lineY(csl)} vectorEffect="non-scaling-stroke" />)}
    </svg>
  </div>;
});
