import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ModelOption, RepairDataset, RepairJob, RepairPanelData, TaskArchitecture } from '@pixel/contracts';
import { api, apiUrl, errorText, requestId, RequestError } from './api';
import { ccrDefinition } from './architectureTemplates';
import { Download, MessageSquare, Plus, Square, X } from './PixelIcons';
import { RepairResults } from './RepairResults';
import { draftItemKey, MAX_REPAIR_ITEMS, readRepairDraft, saveRepairDraft, type RepairDraft } from './repairDraft';
import './RepairPanel.css';

type Props = { taskId: string; architectures: TaskArchitecture[]; models: ModelOption[]; modelId: string; onChat: (id: string) => Promise<void> };
const MAX_COMBINATIONS = MAX_REPAIR_ITEMS;
const labels: Record<RepairJob['status'], string> = { queued: '排队', coding: '编码', compiling: '编译', running: '运行', completed: '完成', failed: '失败', cancelled: '取消', interrupted: '中断' };

function layoutIssue(architecture: TaskArchitecture, dataset: RepairDataset): string | null {
  const definition = ccrDefinition(architecture.description);
  if (!definition) return null;
  return definition.array.rows === dataset.rows && definition.array.cols === dataset.cols
    ? null : `Region ${definition.array.rows} × ${definition.array.cols} 与 wafer ${dataset.rows} × ${dataset.cols} 不匹配`;
}
function percent(value: number) { return `${(value * 100).toFixed(2)}%`; }

export function RepairPanel({ taskId, architectures, models, modelId, onChat }: Props) {
  const [data, setData] = useState<RepairPanelData>({ datasets: [], jobs: [] });
  const [architectureIds, setArchitectureIds] = useState<Set<string>>(new Set());
  const [waferIds, setWaferIds] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState(modelId);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pollRevision, setPollRevision] = useState(0);
  const [draft, setDraft] = useState(() => readRepairDraft(taskId));
  const [storageError, setStorageError] = useState('');
  const submittingRef = useRef(false);

  function updateDraft(next: RepairDraft) {
    setDraft(next);
    setStorageError(saveRepairDraft(taskId, next) ? '' : '浏览器无法保存待运行列表；离开此页或刷新可能丢失草稿。');
  }

  useEffect(() => { setEngine(previous => models.some(item => item.id === previous) ? previous : modelId); }, [modelId, models]);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    let timer: number | undefined;
    const load = async () => {
      controller = new AbortController();
      setLoading(true);
      try {
        const result = await api<RepairPanelData>(`/tasks/${encodeURIComponent(taskId)}/repairs`, { signal: controller.signal });
        if (!alive) return;
        setData(result); setLoadError(''); setLoading(false);
        if (result.jobs.some(job => ['queued', 'coding', 'compiling', 'running'].includes(job.status))) timer = window.setTimeout(load, 2000);
      } catch (reason) {
        if (alive && (reason as Error).name !== 'AbortError') { setLoadError(errorText(reason)); setLoading(false); timer = window.setTimeout(load, 2000); }
      }
    };
    void load();
    return () => { alive = false; controller?.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [taskId, pollRevision]);

  const selectedArchitectures = useMemo(() => architectures.filter(item => architectureIds.has(item.id)), [architectures, architectureIds]);
  const selectedDatasets = useMemo(() => data.datasets.filter(item => waferIds.has(item.id)), [data.datasets, waferIds]);
  const combinations = selectedArchitectures.length * selectedDatasets.length;
  const pairIssues = useMemo(() => combinations > MAX_COMBINATIONS ? [] : selectedArchitectures.flatMap(architecture => selectedDatasets.map(dataset => ({ architecture, dataset, issue: layoutIssue(architecture, dataset) })).filter(item => item.issue)), [selectedArchitectures, selectedDatasets, combinations]);
  const selectedPairs = useMemo(() => combinations > MAX_COMBINATIONS ? [] : selectedArchitectures.flatMap(architecture => selectedDatasets.map(dataset => ({
    architectureId: architecture.id, architectureName: architecture.name, architectureFingerprint: architecture.fingerprint,
    waferId: dataset.id, waferName: dataset.name,
  }))), [selectedArchitectures, selectedDatasets, combinations]);
  const additions = selectedPairs.filter(item => !draft.items.some(existing => draftItemKey(existing) === draftItemKey(item)));
  const canAdd = additions.length > 0 && draft.items.length + additions.length <= MAX_COMBINATIONS && !pairIssues.length && !submitting && !draft.submission && !loading && !loadError;
  const draftIssues = draft.items.map(item => {
    const architecture = architectures.find(value => value.id === item.architectureId);
    const dataset = data.datasets.find(value => value.id === item.waferId);
    const issue = !architecture ? '架构已不存在，请移除此项' : !dataset ? 'wafer 已取消关联，请移除此项或重新关联'
      : architecture.fingerprint !== item.architectureFingerprint ? '架构已修改，请移除后重新添加' : layoutIssue(architecture, dataset);
    return { item, issue };
  });
  const canSubmit = !submitting && (draft.submission !== null || (models.some(item => item.id === engine) && draft.items.length > 0 && !draftIssues.some(item => item.issue) && !loading && !loadError));
  const toggle = (set: Dispatch<SetStateAction<Set<string>>>, id: string) => set(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const allArchitectures = architectures.length > 0 && architectures.every(item => architectureIds.has(item.id));
  const allDatasets = data.datasets.length > 0 && data.datasets.every(item => waferIds.has(item.id));

  function addSelection() {
    if (!canAdd) return;
    updateDraft({ items: [...draft.items, ...additions], submission: null });
  }
  async function submit() {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    const submission = draft.submission ?? { modelId: engine, idempotencyKey: requestId() };
    updateDraft({ ...draft, submission });
    setSubmitting(true); setActionError('');
    try {
      const result = await api<{ items: RepairJob[] }>(`/tasks/${encodeURIComponent(taskId)}/repairs`, { method: 'POST', body: JSON.stringify({ pairs: draft.items.map(({ architectureId, waferId }) => ({ architectureId, waferId })), ...submission }) });
      setData(previous => ({ ...previous, jobs: [...result.items, ...previous.jobs.filter(job => !result.items.some(item => item.id === job.id))] }));
      updateDraft({ items: [], submission: null });
      setPollRevision(value => value + 1);
    } catch (reason) {
      setActionError(errorText(reason));
      // Reuse the request after uncertain network/server responses to avoid duplicate runs.
      if (reason instanceof RequestError && reason.status >= 400 && reason.status < 500 && ![408, 429].includes(reason.status) && reason.code !== 'IDEMPOTENCY_CONFLICT') updateDraft({ ...draft, submission: null });
    }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  async function cancel(job: RepairJob) {
    if (cancelling.has(job.id)) return;
    setCancelling(previous => new Set(previous).add(job.id)); setActionError('');
    try {
      const updated = await api<RepairJob>(`/tasks/${encodeURIComponent(taskId)}/repairs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' });
      setData(previous => ({ ...previous, jobs: previous.jobs.map(item => item.id === updated.id ? updated : item) }));
      setPollRevision(value => value + 1);
    } catch (reason) { setActionError(errorText(reason)); }
    finally { setCancelling(previous => { const next = new Set(previous); next.delete(job.id); return next; }); }
  }
  const download = (job: RepairJob, name: string) => apiUrl(`/tasks/${encodeURIComponent(taskId)}/repairs/${encodeURIComponent(job.id)}/download/${name}`);

  return <section className="repair-panel" aria-busy={loading || submitting}>
    <div className="repair-intro"><h2>选择组合</h2></div>
    {loadError && <div className="workspace-error" role="alert">读取任务求解状态失败：{loadError}</div>}
    {actionError && <div className="workspace-error" role="alert">{actionError}</div>}
    <div className="repair-picker">
      <fieldset><legend>架构</legend><label className="repair-check"><input type="checkbox" checked={allArchitectures} onChange={() => setArchitectureIds(allArchitectures ? new Set() : new Set(architectures.map(item => item.id)))} />全选（{architectures.length}）</label>
      {architectures.map(architecture => <label className="repair-check" key={architecture.id}><input type="checkbox" checked={architectureIds.has(architecture.id)} onChange={() => toggle(setArchitectureIds, architecture.id)} /><span className="repair-option-name" title={architecture.name}>{architecture.name}</span></label>)}
      {!architectures.length && <p>暂无架构</p>}</fieldset>
      <fieldset><legend>已关联 wafer</legend><label className="repair-check"><input type="checkbox" checked={allDatasets} onChange={() => setWaferIds(allDatasets ? new Set() : new Set(data.datasets.map(item => item.id)))} />全选（{data.datasets.length}）</label>
      {data.datasets.map(dataset => <label className="repair-check" key={dataset.id}><input type="checkbox" checked={waferIds.has(dataset.id)} onChange={() => toggle(setWaferIds, dataset.id)} /><span className="repair-option-name" title={dataset.name}>{dataset.name}</span><small>{dataset.productName} · {dataset.chipCount} chip · {dataset.rows} × {dataset.cols}{dataset.synthetic ? ' · 合成' : ''}</small></label>)}
      {!loading && !data.datasets.length && <p>未关联 wafer</p>}</fieldset>
    </div>
    <div className="repair-submit"><span>{selectedArchitectures.length} 个架构 × {selectedDatasets.length} 个 wafer = {combinations} 项</span><button className="action-button" disabled={!canAdd} onClick={addSelection}><Plus />追加到待运行列表{additions.length > 0 ? `（${additions.length}）` : ''}</button>{combinations > 0 && combinations <= MAX_COMBINATIONS && !additions.length && <span>已添加</span>}</div>
    {!!combinations && combinations <= MAX_COMBINATIONS && <details className="repair-preview"><summary>组合预览（{combinations} 项）</summary><ul>{selectedArchitectures.flatMap(architecture => selectedDatasets.map(dataset => <li key={`${architecture.id}:${dataset.id}`}>{architecture.name} × {dataset.name}</li>))}</ul></details>}
    {combinations > MAX_COMBINATIONS && <p className="error-text">单次最多 {MAX_COMBINATIONS} 项，请缩小选择。</p>}
    {draft.items.length + additions.length > MAX_COMBINATIONS && <p className="error-text">待运行列表最多 {MAX_COMBINATIONS} 项；请缩小选择或先运行已有列表。</p>}
    {!!pairIssues.length && <div className="repair-issues" role="alert">{pairIssues.map(item => <p key={`${item.architecture.id}:${item.dataset.id}`}>{item.architecture.name} × {item.dataset.name}：{item.issue}</p>)}</div>}
    <section className="repair-draft" aria-label="待运行列表">
      <div className="repair-job-heading"><h2>待运行列表（{draft.items.length}）</h2><button className="action-button" disabled={!draft.items.length || submitting || !!draft.submission} onClick={() => { updateDraft({ items: [], submission: null }); }}>清空列表</button></div>
      {storageError && <p className="error-text" role="alert">{storageError}</p>}
      {!draft.items.length ? <p className="task-empty">暂无待运行项</p> : <ol className="repair-draft-list">{draftIssues.map(({ item, issue }) => <li key={draftItemKey(item)}>
        <div><span className="repair-draft-name" title={`${item.architectureName} × ${item.waferName}`}>{item.architectureName} × {item.waferName}</span>{!loading && !loadError && issue && <p className="error-text">{issue}</p>}</div>
        <button className="action-button" aria-label={`移除 ${item.architectureName} × ${item.waferName}`} disabled={submitting || !!draft.submission} onClick={() => { updateDraft({ items: draft.items.filter(existing => draftItemKey(existing) !== draftItemKey(item)), submission: null }); }}><X />移除</button>
      </li>)}</ol>}
      <div className="repair-submit"><label>编码引擎<select value={draft.submission?.modelId ?? engine} onChange={event => setEngine(event.target.value)} disabled={submitting || !!draft.submission}>{!models.length && <option value="">尚未配置模型</option>}{draft.submission && !models.some(item => item.id === draft.submission?.modelId) && <option value={draft.submission.modelId}>{draft.submission.modelId}</option>}{models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><button className="action-button primary" disabled={!canSubmit} onClick={() => void submit()}><Square />{submitting ? '正在提交…' : draft.submission ? '确认上次提交 / 重试' : `运行列表（${draft.items.length}）`}</button></div>
      {draft.submission && !submitting && <p className="task-note">提交状态未确认，请重试。</p>}
    </section>
    <RepairResults jobs={data.jobs} architectures={architectures} models={models} />
    <div className="repair-jobs"><h2>求解任务</h2>{!loading && !data.jobs.length && <p className="task-empty">暂无任务</p>}{data.jobs.map(job => { const current = architectures.find(item => item.id === job.architectureId); const historical = !current || current.fingerprint !== job.architectureFingerprint; const downloads = job.status === 'completed' || ['failed', 'cancelled', 'interrupted'].includes(job.status) ? ['dev.hpp', 'result.jsonl', 'manifest.json', 'compile.log'] : []; return <article className="repair-job" key={job.id}><div className="repair-job-heading"><h3>{job.architectureName} × {job.waferName}</h3><span className={`repair-status repair-status-${job.status}`}>{labels[job.status]}</span></div><p>{job.productName}{job.synthetic ? ' · 合成 wafer' : ''} · {job.processedRegions.toLocaleString()} / {job.totalRegions.toLocaleString()} region</p><p className="repair-job-meta">架构快照 {job.architectureFingerprint.slice(0, 8)} · {new Date(job.createdAt).toLocaleString()}</p>{historical && <p className="repair-history-note">历史架构</p>}{job.error && <p className="error-text">{job.error}</p>}{job.summary && <div className="repair-summary"><span>Chip 良率 {percent(job.summary.chipYield)}</span><span>Region 良率 {percent(job.summary.regionYield)}</span><span>完整分母 {job.summary.totalChips.toLocaleString()} chip / {job.summary.totalRegions.toLocaleString()} region</span><span>原始良品 {job.summary.initiallyGoodChips.toLocaleString()} chip / {job.summary.initiallyGoodRegions.toLocaleString()} region</span><span>修补后通过 {job.summary.passedChips.toLocaleString()} chip / {job.summary.passedRegions.toLocaleString()} region</span><span>未修成 {job.summary.unresolvedChips.toLocaleString()} chip / {job.summary.unresolvedRegions.toLocaleString()} region</span></div>}<div className="panel-actions">{['queued', 'coding', 'compiling', 'running'].includes(job.status) && <button className="action-button" disabled={cancelling.has(job.id)} onClick={() => void cancel(job)}><X />{cancelling.has(job.id) ? '正在取消…' : '取消'}</button>}{job.conversationId && <button className="action-button" onClick={() => void onChat(job.conversationId!)}><MessageSquare />查看 Agent 对话</button>}{downloads.map(name => <a className="action-button" key={name} href={download(job, name)} download><Download />{name}</a>)}</div></article>; })}</div>
  </section>;
}
