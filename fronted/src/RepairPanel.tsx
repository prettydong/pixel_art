import { localizeMessage, getLanguage, t } from './i18n';
import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ModelOption, RepairDataset, RepairJob, RepairPanelData, TaskArchitecture } from '@pixel/contracts';
import { api, apiUrl, errorText, requestId, RequestError } from './api';
import { ccrDefinition } from './architectureTemplates';
import { ArchitectureCells, ArchitectureHeaders } from './ArchitectureColumns';
import { ChevronDown, ChevronRight, Download, MessageSquare, Play, Plus, X } from './Icons';
import { RepairResults } from './RepairResults';
import { pinColumns } from './sheetResize';
import { getAutoConclusions } from './solverPreferences';
import { draftItemKey, MAX_REPAIR_ITEMS, readRepairDraft, saveRepairDraft, type RepairDraft } from './repairDraft';
import './RepairPanel.css';

type Props = { taskId: string; architectures: TaskArchitecture[]; models: ModelOption[]; modelId: string; onChat: (id: string) => Promise<void> };
const MAX_COMBINATIONS = MAX_REPAIR_ITEMS;
const labels: Record<RepairJob['status'], string> = { get queued() { return t("排队"); }, get coding() { return t("编码"); }, get compiling() { return t("编译"); }, get running() { return t("运行"); }, get completed() { return t("完成"); }, get failed() { return t("失败"); }, get cancelled() { return t("取消"); }, get interrupted() { return t("中断"); } };

export function layoutIssue(architecture: TaskArchitecture, dataset: RepairDataset): string | null {
  const definition = ccrDefinition(architecture.description);
  if (!definition) return null;
  return definition.array.rows === dataset.rows && definition.array.cols === dataset.cols
    ? null : t("Region {0} × {1} 与 wafer {2} × {3} 不匹配", definition.array.rows, definition.array.cols, dataset.rows, dataset.cols);
}
function percent(value: number) { return `${(value * 100).toFixed(2)}%`; }
/** Configuration columns describe only the architecture version that was queued or run. */
function descriptionFor(architectures: TaskArchitecture[], id: string, fingerprint: string) {
  return architectures.find(item => item.id === id && item.fingerprint === fingerprint)?.description;
}
const activeStatuses: RepairJob['status'][] = ['queued', 'coding', 'compiling', 'running'];
const PROGRESS_WIDTH = 60;

export function RepairPanel({ taskId, architectures, models, modelId, onChat }: Props) {
  const [data, setData] = useState<RepairPanelData>({ datasets: [], jobs: [] });
  const [architectureIds, setArchitectureIds] = useState<Set<string>>(() => new Set(readRepairDraft(taskId).items.map(item => item.architectureId)));
  const [waferIds, setWaferIds] = useState<Set<string>>(() => new Set(readRepairDraft(taskId).items.map(item => item.waferId)));
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
    setStorageError(saveRepairDraft(taskId, next) ? '' : t("浏览器无法保存待运行列表；离开此页或刷新可能丢失草稿。"));
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
    const issue = !architecture ? t("架构已不存在，请移除此项") : !dataset ? t("wafer 已取消关联，请移除此项或重新关联")
      : architecture.fingerprint !== item.architectureFingerprint ? t("架构已修改，请移除后重新添加") : layoutIssue(architecture, dataset);
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
    const submission = draft.submission ?? { modelId: engine, idempotencyKey: requestId(), autoConclusion: getAutoConclusions() };
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

  // Completed results matter most once they exist; running jobs are listed before finished ones.
  const hasResults = data.jobs.some(job => job.status === 'completed' && job.summary);
  const jobs = [...data.jobs].sort((a, b) => Number(activeStatuses.includes(b.status)) - Number(activeStatuses.includes(a.status)));
  const runningCount = jobs.filter(job => activeStatuses.includes(job.status)).length;

  return <section className="repair-panel" aria-busy={loading || submitting}>
    {loadError && <div className="workspace-error" role="alert">{t("读取任务求解状态失败：")}{localizeMessage(loadError)}</div>}
    {actionError && <div className="workspace-error" role="alert">{localizeMessage(actionError)}</div>}
    {hasResults && <RepairResults jobs={data.jobs} architectures={architectures} models={models} />}
    <div className="repair-intro"><h2>{t("选择组合")}</h2></div>
    <div className="repair-picker">
      <div className="sheet-frame sheet-scroll"><table className="sheet">
        <thead><tr><th scope="col" className="sheet-check"><input type="checkbox" aria-label={t("全选（") + architectures.length + t("）")} checked={allArchitectures} disabled={!architectures.length} onChange={() => setArchitectureIds(allArchitectures ? new Set() : new Set(architectures.map(item => item.id)))} /></th><th scope="col">{t("架构")} ({architectures.length})</th><ArchitectureHeaders region /></tr></thead>
        <tbody>{architectures.map(architecture => <tr className={`sheet-row ${architectureIds.has(architecture.id) ? 'is-selected' : ''}`} key={architecture.id} onClick={event => { if (!(event.target as Element).closest('input')) toggle(setArchitectureIds, architecture.id); }}>
          <td className="sheet-check"><input type="checkbox" aria-label={architecture.name} checked={architectureIds.has(architecture.id)} onChange={() => toggle(setArchitectureIds, architecture.id)} /></td><th scope="row" title={architecture.name}>{architecture.name}</th><ArchitectureCells description={architecture.description} region />
        </tr>)}
        {!architectures.length && <tr className="sheet-empty"><td colSpan={8}>{t("暂无架构")}</td></tr>}</tbody>
      </table></div>
      <div className="sheet-frame sheet-scroll"><table className="sheet">
        <thead><tr><th scope="col" className="sheet-check"><input type="checkbox" aria-label={t("全选（") + data.datasets.length + t("）")} checked={allDatasets} disabled={!data.datasets.length} onChange={() => setWaferIds(allDatasets ? new Set() : new Set(data.datasets.map(item => item.id)))} /></th><th scope="col">{t("已关联 wafer")} ({data.datasets.length})</th><th scope="col">{t("来源")}</th><th scope="col">{t("产品")}</th><th scope="col" className="sheet-num">Chip</th><th scope="col" className="sheet-num sheet-optional">Row</th><th scope="col" className="sheet-num sheet-optional">Col</th></tr></thead>
        <tbody>{data.datasets.map(dataset => <tr className={`sheet-row ${waferIds.has(dataset.id) ? 'is-selected' : ''}`} key={dataset.id} onClick={event => { if (!(event.target as Element).closest('input')) toggle(setWaferIds, dataset.id); }}>
          <td className="sheet-check"><input type="checkbox" aria-label={dataset.name} checked={waferIds.has(dataset.id)} onChange={() => toggle(setWaferIds, dataset.id)} /></td><th scope="row" title={dataset.name}>{dataset.name}</th><td>{dataset.synthetic ? <span className="data-badge data-badge-warn">{t("合成")}</span> : <span className="sheet-muted">{t("导入")}</span>}</td><td className="sheet-muted">{dataset.productName}</td><td className="sheet-num sheet-muted">{dataset.chipCount}</td><td className="sheet-num sheet-muted sheet-optional">{dataset.rows}</td><td className="sheet-num sheet-muted sheet-optional">{dataset.cols}</td>
        </tr>)}
        {!loading && !data.datasets.length && <tr className="sheet-empty"><td colSpan={7}>{t("未关联 wafer")}</td></tr>}</tbody>
      </table></div>
    </div>
    <div className="repair-submit"><span>{selectedArchitectures.length} {" " + t("个架构 ×") + " "}{selectedDatasets.length} {" " + t("个 wafer =") + " "}{combinations} {" " + t("项")}</span><button className="action-button" disabled={!canAdd} onClick={addSelection}><Plus />{t("追加到待运行列表")}{additions.length > 0 ? t("（{0}）", additions.length) : ''}</button>{combinations > 0 && combinations <= MAX_COMBINATIONS && !additions.length && <span>{t("已添加")}</span>}</div>
    {!!combinations && combinations <= MAX_COMBINATIONS && <details className="repair-preview"><summary>{t("组合预览（")}{combinations} {" " + t("项）")}</summary><ul>{selectedArchitectures.flatMap(architecture => selectedDatasets.map(dataset => <li key={`${architecture.id}:${dataset.id}`}>{architecture.name} × {dataset.name}</li>))}</ul></details>}
    {combinations > MAX_COMBINATIONS && <p className="error-text">{t("单次最多") + " "}{MAX_COMBINATIONS} {" " + t("项，请缩小选择。")}</p>}
    {draft.items.length + additions.length > MAX_COMBINATIONS && <p className="error-text">{t("待运行列表最多") + " "}{MAX_COMBINATIONS} {" " + t("项；请缩小选择或先运行已有列表。")}</p>}
    {!!pairIssues.length && <div className="repair-issues" role="alert">{pairIssues.map(item => <p key={`${item.architecture.id}:${item.dataset.id}`}>{item.architecture.name} × {item.dataset.name}{t("：")}{item.issue}</p>)}</div>}
    <section className="repair-draft" aria-label={t("待运行列表")}>
      <div className="repair-job-heading"><h2>{t("待运行列表（")}{draft.items.length}{t("）")}</h2><button className="action-button" disabled={!draft.items.length || submitting || !!draft.submission} onClick={() => { updateDraft({ items: [], submission: null }); }}>{t("清空列表")}</button></div>
      {storageError && <p className="error-text" role="alert">{localizeMessage(storageError)}</p>}
      {!draft.items.length ? <p className="task-empty">{t("暂无待运行项")}</p> : <div className="sheet-frame sheet-scroll"><table className="sheet">
        <thead><tr><th scope="col">{t("架构")}</th><ArchitectureHeaders /><th scope="col">Wafer</th><th scope="col" style={{ width: 48 }}><span className="visually-hidden">{t("移除")}</span></th></tr></thead>
        <tbody>{draftIssues.map(({ item, issue }) => <Fragment key={draftItemKey(item)}>
          <tr><th scope="row" title={item.architectureName}>{item.architectureName}</th><ArchitectureCells description={descriptionFor(architectures, item.architectureId, item.architectureFingerprint)} /><td title={item.waferName}>{item.waferName}</td>
            <td><button className="icon-button repair-remove" title={t("移除")} aria-label={t("移除 {0} × {1}", item.architectureName, item.waferName)} disabled={submitting || !!draft.submission} onClick={() => { updateDraft({ items: draft.items.filter(existing => draftItemKey(existing) !== draftItemKey(item)), submission: null }); }}><X /></button></td></tr>
          {!loading && !loadError && issue && <tr className="sheet-note"><td colSpan={7} className="error-text">{localizeMessage(issue)}</td></tr>}
        </Fragment>)}</tbody>
      </table></div>}
      <div className="repair-submit"><label>{t("编码引擎")}<select value={draft.submission?.modelId ?? engine} onChange={event => setEngine(event.target.value)} disabled={submitting || !!draft.submission}>{!models.length && <option value="">{t("尚未配置模型")}</option>}{draft.submission && !models.some(item => item.id === draft.submission?.modelId) && <option value={draft.submission.modelId}>{draft.submission.modelId}</option>}{models.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><button className="action-button primary" disabled={!canSubmit} onClick={() => void submit()}><Play />{submitting ? t("正在提交…") : draft.submission ? t("确认上次提交 / 重试") : t("运行列表（{0}）", draft.items.length)}</button></div>
      {draft.submission && !submitting && <p className="task-note">{t("提交状态未确认，请重试。")}</p>}
    </section>
    <div className="repair-jobs"><div className="repair-job-heading"><h2>{t("求解任务")}{jobs.length ? ` (${jobs.length})` : ''}</h2>{runningCount > 0 && <span className="repair-status repair-status-running">{t("进行中 {0}", runningCount)}</span>}</div>
      {!loading && !jobs.length && <p className="task-empty">{t("暂无求解任务")}</p>}
      {!!jobs.length && <div className="sheet-frame"><table className="sheet sheet-pinned" ref={pinJobColumns}>
        <thead><tr><th scope="col">{t("架构")}</th><th scope="col" className="sheet-num">{t("Chip 良率")}</th><th scope="col" className="sheet-num">{t("Region 良率")}</th><ArchitectureHeaders /><th scope="col">Wafer</th><th scope="col">{t("来源")}</th><th scope="col" className="sheet-optional">{t("编码引擎")}</th><th scope="col" style={{ width: 80 }}>{t("状态")}</th><th scope="col" className="sheet-optional" style={{ width: 120 }}>{t("进度")}</th><th scope="col" style={{ width: 100 }}><span className="visually-hidden">{t("取消")}</span></th></tr></thead>
        <tbody>{jobs.map(job => <RepairJobRow key={job.id} job={job} architectures={architectures} models={models} cancelling={cancelling.has(job.id)} onCancel={() => void cancel(job)} onChat={onChat} download={name => download(job, name)} />)}</tbody>
      </table></div>}
    </div>
  </section>;
}

// Architecture, Chip yield and Region yield stay in view while the jobs sheet scrolls sideways.
const pinJobColumns = pinColumns(3);

function RepairJobRow({ job, architectures, models, cancelling, onCancel, onChat, download }: { job: RepairJob; architectures: TaskArchitecture[]; models: ModelOption[]; cancelling: boolean; onCancel: () => void; onChat: (id: string) => Promise<void>; download: (name: string) => string }) {
  const [open, setOpen] = useState(false);
  const language = getLanguage();
  const current = architectures.find(item => item.id === job.architectureId);
  const historical = !current || current.fingerprint !== job.architectureFingerprint;
  const active = activeStatuses.includes(job.status);
  const downloads = job.status === 'completed' || ['failed', 'cancelled', 'interrupted'].includes(job.status) ? ['dev.hpp', 'result.jsonl', 'manifest.json', 'compile.log'] : [];
  const ratio = job.totalRegions > 0 ? Math.min(1, job.processedRegions / job.totalRegions) : 0;
  const progressLabel = `${job.processedRegions.toLocaleString(language)} / ${job.totalRegions.toLocaleString(language)} region`;
  const name = `${job.architectureName} × ${job.waferName}`;
  return <>
    <tr className={`sheet-row ${open ? 'is-open' : ''}`} onClick={event => { if (!(event.target as Element).closest('button, a')) setOpen(value => !value); }}>
      <th scope="row"><button className="sheet-toggle" aria-expanded={open} title={name} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown /> : <ChevronRight />}<span>{job.architectureName}</span></button></th>
      <td className="stat-value sheet-num">{job.summary ? percent(job.summary.chipYield) : '–'}</td>
      <td className="stat-value sheet-num">{job.summary ? percent(job.summary.regionYield) : '–'}</td>
      <ArchitectureCells description={descriptionFor(architectures, job.architectureId, job.architectureFingerprint)} />
      <td title={job.waferName}>{job.waferName}</td>
      <td>{job.synthetic ? <span className="data-badge data-badge-warn">{t("合成")}</span> : <span className="sheet-muted">{t("导入")}</span>}</td>
      <td className="sheet-muted sheet-optional">{models.find(model => model.id === job.modelId)?.label ?? job.modelId}</td>
      <td><span className={`repair-status repair-status-${job.status}`}>{labels[job.status]}</span></td>
      <td className="sheet-optional"><span className={`repair-progress ${active ? 'repair-progress-active' : ''}`} title={progressLabel}><span className="repair-progress-bar" role="img" aria-label={progressLabel} style={{ width: `${PROGRESS_WIDTH}px` }}><i style={{ width: `${Math.round(ratio * PROGRESS_WIDTH)}px` }} /></span>{Math.round(ratio * 100)}%</span></td>
      <td>{active && <button className="action-button" disabled={cancelling} onClick={onCancel}><X />{cancelling ? t("正在取消…") : t("取消")}</button>}</td>
    </tr>
    {open && <tr className="sheet-detail"><td colSpan={13}><div>
      <p className="repair-job-meta">{progressLabel} · {job.productName} · {models.find(model => model.id === job.modelId)?.label ?? job.modelId} · {t("架构快照") + " "}{job.architectureFingerprint.slice(0, 8)} · {new Date(job.createdAt).toLocaleString(language)}{historical && <span className="repair-history-note">{" · " + t("历史架构")}</span>}</p>
      {job.error && <p className="error-text">{localizeMessage(job.error)}</p>}
      {job.summary && <div className="repair-summary"><span>{t("完整分母") + " "}{job.summary.totalChips.toLocaleString(language)} chip / {job.summary.totalRegions.toLocaleString(language)} region</span><span>{t("原始良品") + " "}{job.summary.initiallyGoodChips.toLocaleString(language)} chip / {job.summary.initiallyGoodRegions.toLocaleString(language)} region</span><span>{t("修补后通过") + " "}{job.summary.passedChips.toLocaleString(language)} chip / {job.summary.passedRegions.toLocaleString(language)} region</span><span>{t("未修成") + " "}{job.summary.unresolvedChips.toLocaleString(language)} chip / {job.summary.unresolvedRegions.toLocaleString(language)} region</span></div>}
      {(job.conversationId || downloads.length > 0) && <div className="panel-actions">{job.conversationId && <button className="action-button" onClick={() => void onChat(job.conversationId!)}><MessageSquare />{t("查看 Agent 对话")}</button>}{downloads.map(file => <a className="action-button" key={file} href={download(file)} download><Download />{file}</a>)}</div>}
    </div></td></tr>}
  </>;
}
