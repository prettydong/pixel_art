import { localizeMessage, t } from './i18n';
import { ArchitecturePreview } from './ArchitecturePreview';
import { CcrLayoutPreview } from './CcrLayoutPreview';
import { ArchitectureDrawingProgress, findArchitectureDrawing, statusText } from './ArchitectureDrawingProgress';
import { ArchitectureEditor } from './ArchitectureEditor';
import { architectureSummary } from './architectureTemplates';
import { WaferData } from './WaferData';
import { RepairPanel } from './RepairPanel';
import { SolverConclusions } from './SolverConclusions';
import { useEffect, useState } from 'react';
import type { FileRecord, ModelOption, TaskDetail, TaskArchitecture } from '@pixel/contracts';
import { isActiveRun } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { api, errorText, fileUrl } from './api';
import { MarkdownMessage } from './MarkdownMessage';
import { StatTile } from './StatTile';
import { groupReplyMessages } from './replyMessages';
import { ChevronDown, ChevronRight, Download, Plus } from './PixelIcons';
import { taskViewLabels, type TaskView } from './TaskNavigation';
import './ArchitectureCollapse.css';

function readCollapsedArchitectures(taskId: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(`pixel:collapsed-architectures:${taskId}`) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 1000) : []);
  } catch { return new Set(); }
}

type Props = { taskId: string; view: Exclude<TaskView, 'chat'>; revision: number; conversations: Conversation[]; connections: Record<string, string>; models: ModelOption[]; modelId: string; onRefresh: () => Promise<void>; onChat: (id: string) => void; onRepairChat: (id: string) => Promise<void>; onCreateChat: (taskId: string) => Promise<void>; onGeneratePreview: (architecture: TaskArchitecture) => Promise<void>; previewAvailable: boolean };
export function TaskPanel({ taskId, view, revision, conversations, connections, models, modelId, onRefresh, onChat, onRepairChat, onCreateChat, onGeneratePreview, previewAvailable }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [startingArchitecture, setStartingArchitecture] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [collapsedArchitectures, setCollapsedArchitectures] = useState(() => readCollapsedArchitectures(taskId));
  useEffect(() => {
    try { localStorage.setItem(`pixel:collapsed-architectures:${taskId}`, JSON.stringify([...collapsedArchitectures])); }
    catch { /* Storage restrictions must not prevent folding in this session. */ }
  }, [taskId, collapsedArchitectures]);
  function toggleArchitecture(id: string) {
    setCollapsedArchitectures(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  useEffect(() => {
    let alive = true; setDetail(previous => previous?.id === taskId ? previous : null); setLoading(true);
    api<TaskDetail>(`/tasks/${taskId}`).then(result => { if (alive) { setDetail(result); setLoadError(''); } })
      .catch(err => { if (alive) setLoadError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [taskId, revision, reload]);
  async function action(work: () => Promise<unknown>) {
    if (pending) return; setPending(true); setError('');
    try { await work(); }
    catch (err) { setError(errorText(err)); }
    finally { try { await onRefresh(); setReload(value => value + 1); } finally { setPending(false); } }
  }
  const uploads = detail?.id === taskId ? detail.files.filter(file => file.kind === 'upload') : [];
  const artifacts = detail?.files.filter(file => file.kind === 'artifact') ?? [];
  const chats = conversations.filter(chat => chat.taskId === taskId);
  const downloads = (files: FileRecord[]) => <ul className="task-files">{files.map(file => <li key={file.id}><a href={fileUrl(file)} download><Download /><span>{file.name}</span></a></li>)}</ul>;
  return <section className="task-panel" aria-label={taskViewLabels[view]} aria-busy={loading || pending}>
    {/* The top bar already shows the task and view; keep the heading for assistive technology only. */}
    <h1 className="visually-hidden">{taskViewLabels[view]}{detail ? ` · ${detail.name}` : ''}</h1>
    {loading && !detail && <p role="status">{t("正在读取任务资料…")}</p>}
    {(error || loadError) && <div className="workspace-error" role="alert">{error || loadError}<button onClick={() => { setError(''); setReload(value => value + 1); }}>{t("重新读取")}</button></div>}
    {view === 'architecture' && <>
      {!editing && <div className="panel-actions">
        <button className="action-button" disabled={pending || !!editing} onClick={() => setEditing({ id: 'new', name: '', description: '' })}><Plus />{t("新建架构")}</button>
        {detail && detail.architectures.length > 1 && <button type="button" className="action-button" onClick={() => setCollapsedArchitectures(detail.architectures.every(architecture => collapsedArchitectures.has(architecture.id)) ? new Set() : new Set(detail.architectures.map(architecture => architecture.id)))}>{detail.architectures.every(architecture => collapsedArchitectures.has(architecture.id)) ? t("全部展开") : t("全部收起")}</button>}
      </div>}
      {editing && <ArchitectureEditor key={editing.id} initial={editing.id === 'new' ? undefined : editing} pending={pending} onCancel={() => setEditing(null)} onSave={async (name, description) => {
        if (pending) return;
        setPending(true); setError('');
        try {
          await api(`/tasks/${taskId}/architectures${editing.id === 'new' ? '' : `/${editing.id}`}`, { method: editing.id === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ name, description }) });
          setEditing(null);
          await onRefresh().catch(err => setError(t("架构已保存，但刷新失败：{0}", errorText(err))));
          setReload(value => value + 1);
        } finally { setPending(false); }
      }} />}
      {!editing && !loading && !detail?.architectures.length && <p className="task-empty">{t("暂无架构")}</p>}
      {!editing && detail?.architectures.map(architecture => {
        const starting = startingArchitecture === architecture.id;
        const drawing = starting ? undefined : findArchitectureDrawing(chats, architecture.id);
        const drawingActive = starting || !!(drawing && isActiveRun(drawing.run.status));
        const previewReady = !!drawing && !!architecture.previews?.some(preview => preview.file.conversationId === drawing.conversation.id && preview.createdAt >= drawing.run.createdAt);
        const collapsed = collapsedArchitectures.has(architecture.id);
        const bodyId = `architecture-body-${architecture.id}`;
        const summary = architectureSummary(architecture.description);
        const progress = <ArchitectureDrawingProgress key={starting ? 'starting' : drawing?.run.id ?? 'idle'} drawing={drawing} starting={starting} connection={drawing ? connections[drawing.conversation.id] : undefined} previewReady={previewReady} onOpenChat={onChat} />;
        return <article className="task-record architecture-record" key={architecture.id}>
        <div className="task-record-heading architecture-record-heading"><h2><button type="button" className="architecture-fold-toggle" aria-expanded={!collapsed} aria-controls={bodyId} aria-label={t("{0}架构：{1}", collapsed ? t("展开") : t("折叠"), architecture.name)} onClick={() => toggleArchitecture(architecture.id)}>{collapsed ? <ChevronRight /> : <ChevronDown />}<span>{architecture.name}</span></button></h2>
          {architecture.sourceFile && <span className="data-badge">{t("已执行的架构快照")}</span>}
          <button className="action-button" disabled={pending || !previewAvailable || drawingActive} onClick={() => {
            setStartingArchitecture(architecture.id);
            void action(() => onGeneratePreview(architecture)).finally(() => setStartingArchitecture(null));
          }}>{drawingActive ? t("正在绘制…") : architecture.previews?.length ? t("重新绘制示意图") : t("Agent 绘制示意图")}</button>
          {!architecture.sourceFile && <button className="action-button" disabled={pending || !!editing} onClick={() => setEditing({ id: architecture.id, name: architecture.name, description: architecture.description })}>{t("编辑")}</button>}
        </div>
        {architecture.previewIssues?.length ? <p className="task-warning" role="status">{[...new Set(architecture.previewIssues)].map(localizeMessage).join(' ')}</p> : null}
        {summary && <p className="task-note">{summary}</p>}
        {collapsed && <p className={drawing?.run.error ? 'error-text architecture-collapsed-status' : 'task-note architecture-collapsed-status'} role="status">
          {drawing || starting ? statusText(drawing?.run, starting, previewReady) : architecture.previews?.length ? t("{0} 份 Agent 绘图", architecture.previews.length) : summary ? t("可展开查看 CCR 结构") : t("尚无预览")}
          {drawingActive && drawing && connections[drawing.conversation.id] ? ` · ${connections[drawing.conversation.id]}` : ''}
          {drawing?.run.error ? ` · ${drawing.run.error}` : ''}
        </p>}
        <div id={bodyId} className="architecture-record-body" hidden={collapsed}>{!collapsed && <>
        <CcrLayoutPreview description={architecture.description} />
        {drawingActive || drawing?.run.error || (drawing && !previewReady) ? progress : drawing ? <details className="architecture-record-details"><summary>{t("绘制记录 ·") + " "}{statusText(drawing.run, false, previewReady)}</summary>{progress}</details> : null}
        {!!architecture.previews?.length && <ArchitecturePreview previews={architecture.previews} />}
        <details className="architecture-record-details"><summary>{t("定义与来源")}</summary><pre className="architecture-definition">{architecture.description}</pre>
        {architecture.sourceConversationId && <button className="action-button" onClick={() => onChat(architecture.sourceConversationId!)}>{t("查看来源聊天")}</button>}
        {architecture.sourceFile && downloads([architecture.sourceFile])}
        </details>
        </>}</div>
      </article>; })}
    </>}
    {view === 'data' && <WaferData key={taskId} taskId={taskId} files={uploads} onChanged={async () => { await onRefresh(); setReload(value => value + 1); }} />}
    {view === 'repair' && detail && <RepairPanel taskId={taskId} architectures={detail.architectures} models={models} modelId={modelId} onChat={onRepairChat} />}
    {view === 'conclusions' && <>
      <SolverConclusions key={taskId} taskId={taskId} revision={revision} models={models} />
      {artifacts.length > 0 && <div className="stat-tiles">
        <StatTile label={t("执行产物")} value={String(artifacts.length)} />
        <StatTile label={t("报告")} value={String(detail?.reports.length ?? 0)} />
        <StatTile label={t("含产物的聊天")} value={String(new Set(artifacts.map(file => file.conversationId)).size)} />
      </div>}
      {chats.map(chat => {
        const files = artifacts.filter(file => file.conversationId === chat.id);
        if (!files.length) return null;
        const reports = detail?.reports.filter(report => files.some(file => file.id === report.fileId)) ?? [];
        const reply = groupReplyMessages(chat.messages).filter(message => message.role === 'assistant' && message.text).at(-1);
        return <article className="task-record" key={chat.id}>
          <div className="task-record-heading"><h2>{chat.title}</h2><button className="action-button" onClick={() => onChat(chat.id)}>{t("打开聊天")}</button></div>
          {reports.map((report, index) => <details className="task-conclusion" open={index === 0} key={report.fileId}><summary>{files.find(file => file.id === report.fileId)?.name}</summary><MarkdownMessage text={report.text} /></details>)}
          {!reports.length && reply && <details className="task-conclusion" open><summary>{t("最近回复")}</summary><MarkdownMessage text={reply.text} /></details>}
          <details open><summary>{t("执行产物（")}{files.length}{t("）")}</summary>{downloads(files)}</details>
        </article>;
      })}
    </>}
    {!(view === 'architecture' && editing) && <div className="panel-actions"><button className="action-button" disabled={pending} onClick={() => void action(() => onCreateChat(taskId))}><Plus />{t("新建聊天")}</button></div>}
  </section>;
}
