import { t } from './i18n';
import { useEffect, useState } from 'react';
import type { RepairPanelData, TaskDetail, ToolCall } from '@pixel/contracts';
import { readCardTool, type AskCard, type SolverCard } from '@pixel/contracts/chat-cards';
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
};

export function ChatCard({ tool, context }: { tool: ToolCall; context?: CardContext }) {
  const card = readCardTool(tool);
  if (!card) return <p className="chart-unavailable">{t("卡片数据无效或不完整，请查看工具详情或让 agent 重新生成。")}</p>;
  return card.kind === 'ask' ? <AskCardView id={tool.id} card={card} context={context} /> : <SolverCardView id={tool.id} card={card} context={context} />;
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
