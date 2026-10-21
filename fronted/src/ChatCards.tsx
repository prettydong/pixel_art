import { t } from './i18n';
import { useEffect, useState } from 'react';
import type { RepairPanelData, TaskArchitecture, TaskDetail, ToolCall } from '@pixel/contracts';
import { readCardTool, type ArchitectureCard, type AskCard, type SolverCard } from '@pixel/contracts/chat-cards';
import { architectureColumns } from './architectureTemplates';
import { api, errorText } from './api';
import type { InteractiveTool, ToolResult } from './chatTypes';
import { InteractiveTools } from './InteractiveTools';
import { ArrowRight, Check } from './Icons';
import { layoutIssue } from './RepairPanel';
import { MAX_REPAIR_ITEMS, readRepairDraft, saveRepairDraft } from './repairDraft';

/** Chat state supplied by the conversation; without it cards render read-only. */
export type CardContext = {
  taskId: string;
  /** A reply is running or an answer is being sent. */
  locked: boolean;
  /** Pending only on the latest reply of an idle conversation. */
  askState: (toolId: string) => { status: InteractiveTool['status']; result?: ToolResult };
  onAnswer: (tool: InteractiveTool, result: ToolResult) => void;
  onOpenSolver: () => void;
  onOpenArchitectures: () => void;
};

export function ChatCard({ tool, context }: { tool: ToolCall; context?: CardContext }) {
  const card = readCardTool(tool);
  if (!card) return <p className="chart-unavailable">{t("卡片数据无效或不完整，请查看工具详情或让 agent 重新生成。")}</p>;
  if (card.kind === 'ask') return <AskCardView id={tool.id} card={card} context={context} />;
  if (card.kind === 'architecture') return <ArchitectureCardView id={tool.id} card={card} context={context} />;
  return <SolverCardView id={tool.id} card={card} context={context} />;
}

function AskCardView({ id, card, context }: { id: string; card: AskCard; context?: CardContext }) {
  const state = context?.askState(id) ?? { status: 'expired' as const };
  const base = { id, title: card.title, description: card.description, status: state.status, result: state.result };
  const tool: InteractiveTool = card.type === 'single' || card.type === 'multi'
    ? { ...base, type: card.type, options: card.options! }
    : card.type === 'form' ? { ...base, type: 'form', fields: card.fields! }
    : { ...base, type: 'confirm', confirmLabel: card.confirmLabel, cancelLabel: card.cancelLabel };
  return <InteractiveTools tools={[tool]} disabled={!context || context.locked} onSubmit={result => context?.onAnswer(tool, result)} />;
}

type SolverData = { detail: TaskDetail; panel: RepairPanelData };
const applied = new Set<string>();

function SolverCardView({ id, card, context }: { id: string; card: SolverCard; context?: CardContext }) {
  const taskId = context?.taskId;
  const [data, setData] = useState<SolverData | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(() => applied.has(id));
  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    const path = `/tasks/${encodeURIComponent(taskId)}`;
    Promise.all([api<TaskDetail>(path, { signal: controller.signal }), api<RepairPanelData>(`${path}/repairs`, { signal: controller.signal })])
      .then(([detail, panel]) => { setData({ detail, panel }); setError(''); })
      .catch(reason => { if ((reason as Error).name !== 'AbortError') setError(errorText(reason)); });
    return () => controller.abort();
  }, [taskId]);

  const architectures = card.architectureIds.map(value => ({ id: value, item: data?.detail.architectures.find(item => item.id === value) }));
  const wafers = card.waferIds.map(value => ({ id: value, item: data?.panel.datasets.find(item => item.id === value) }));
  const missing = [...architectures, ...wafers].filter(entry => !entry.item).length;
  const pairs = architectures.flatMap(({ item: architecture }) => wafers.flatMap(({ item: dataset }) => architecture && dataset ? [{ architecture, dataset }] : []));
  const mismatched = pairs.filter(pair => layoutIssue(pair.architecture, pair.dataset)).length;
  const current = taskId ? readRepairDraft(taskId) : null;

  function apply() {
    if (!taskId || !data || !current) return;
    if (current.submission) { setError(t("Solver 有一个提交尚未确认，请先在 Solver 页完成或重试。")); return; }
    const items = pairs.slice(0, MAX_REPAIR_ITEMS).map(({ architecture, dataset }) => ({
      architectureId: architecture.id, architectureName: architecture.name, architectureFingerprint: architecture.fingerprint,
      waferId: dataset.id, waferName: dataset.name,
    }));
    if (!saveRepairDraft(taskId, { items, submission: null })) setError(t("浏览器无法保存待运行列表；离开此页或刷新可能丢失草稿。"));
    applied.add(id); setDone(true);
    context?.onOpenSolver();
  }

  const name = (entry: { id: string; item?: { name: string } }) => entry.item?.name ?? (data ? t("未找到：{0}", entry.id) : entry.id);
  return <section className="interactive-tool solver-card" aria-label={t("Solver 配置")}>
    <fieldset>
      <legend>{t("Solver 配置")}</legend>
      {card.note && <p className="interactive-tool-description">{card.note}</p>}
      <dl className="solver-card-lists">
        <dt>{t("架构")}</dt>
        <dd>{architectures.map(entry => <span key={entry.id} className={entry.item || !data ? '' : 'error-text'}>{name(entry)}</span>)}</dd>
        <dt>Wafer</dt>
        <dd>{wafers.map(entry => <span key={entry.id} className={entry.item || !data ? '' : 'error-text'}>{name(entry)}</span>)}</dd>
      </dl>
      <p className="interactive-tool-status">
        {t("{0} 个组合", pairs.length)}
        {missing > 0 && <span className="error-text">{" · " + t("{0} 项不在当前任务中", missing)}</span>}
        {mismatched > 0 && <span className="error-text">{" · " + t("{0} 个组合尺寸不匹配", mismatched)}</span>}
      </p>
      {error && <p className="interactive-tool-error" role="alert">{error}</p>}
      <div className="interactive-tool-actions">
        {done ? <button type="button" onClick={() => context?.onOpenSolver()} disabled={!context}><Check />{t("已应用")} · {t("打开 Solver")}<ArrowRight /></button>
          : <button type="button" className="interactive-tool-submit" disabled={!context || !data || !pairs.length} onClick={apply}>
            {current?.items.length ? t("替换 Solver 待运行列表（{0}）", current.items.length) : t("应用到 Solver")}
          </button>}
      </div>
    </fieldset>
  </section>;
}

const saved = new Map<string, string>();

/** The agent only proposes; this card's Save button is the one place a chat architecture is added. */
function ArchitectureCardView({ id, card, context }: { id: string; card: ArchitectureCard; context?: CardContext }) {
  const taskId = context?.taskId;
  const [name, setName] = useState(card.name);
  const [existing, setExisting] = useState<TaskArchitecture[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState(() => saved.get(id));
  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    api<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}`, { signal: controller.signal })
      .then(detail => { setExisting(detail.architectures); setError(''); })
      .catch(reason => { if ((reason as Error).name !== 'AbortError') setError(errorText(reason)); });
    return () => controller.abort();
  }, [taskId]);

  const trimmed = name.trim();
  const identical = existing?.find(item => item.name === trimmed && item.description === card.description);
  const conflict = !identical && !!existing?.some(item => item.name === trimmed);
  const done = !!savedId || !!identical;
  const columns = architectureColumns(card.description);

  async function save() {
    if (!taskId || saving || done || conflict || !trimmed) return;
    setSaving(true); setError('');
    try {
      const architecture = await api<TaskArchitecture>(`/tasks/${encodeURIComponent(taskId)}/architectures`, { method: 'POST', body: JSON.stringify({ name: trimmed, description: card.description }) });
      saved.set(id, architecture.id); setSavedId(architecture.id);
      setExisting(previous => [...(previous ?? []), architecture]);
      window.dispatchEvent(new Event('pixel:tasks'));
    } catch (reason) { setError(errorText(reason)); }
    finally { setSaving(false); }
  }

  return <section className="interactive-tool architecture-card" aria-label={t("架构提议")}>
    <fieldset disabled={!context}>
      <legend>{t("架构提议")}</legend>
      <div className="interactive-tool-field">
        <label htmlFor={`${id}-name`}>{t("名称")}</label>
        <input id={`${id}-name`} value={name} maxLength={120} disabled={done || saving} aria-invalid={conflict} onChange={event => setName(event.target.value)} />
      </div>
      {columns ? <dl className="solver-card-lists architecture-card-values">
        <dt>Region row × col</dt><dd><span>{columns.rows} × {columns.cols}</span></dd>
        <dt>{t("备用 row")}</dt><dd><span>{columns.spareRows}</span></dd>
        <dt>{t("CCR col/组")}</dt><dd><span>{columns.ccrCols}</span></dd>
        <dt>{t("CCR 组/段")}</dt><dd><span>{columns.groups}</span></dd>
        <dt>Segment</dt><dd><span>{columns.segments}</span></dd>
      </dl> : <p className="interactive-tool-status">{t("不是标准 CCR 定义，请展开完整定义核对。")}</p>}
      <details className="architecture-card-definition">
        <summary>{t("完整定义")}</summary>
        <pre>{card.description}</pre>
      </details>
      {conflict && <p className="interactive-tool-error" role="alert">{t("已有同名但内容不同的架构，请改名后保存。")}</p>}
      {!savedId && identical && <p className="interactive-tool-status">{t("任务中已有相同架构。")}</p>}
      {error && <p className="interactive-tool-error" role="alert">{error}</p>}
      <div className="interactive-tool-actions">
        {done ? <button type="button" onClick={() => context?.onOpenArchitectures()}><Check />{savedId ? t("已保存") : t("已存在")} · {t("打开架构")}<ArrowRight /></button>
          : <button type="button" className="interactive-tool-submit" disabled={!existing || saving || conflict || !trimmed} onClick={() => void save()}>{saving ? t("保存中…") : t("保存架构")}</button>}
      </div>
    </fieldset>
  </section>;
}
