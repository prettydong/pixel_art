import { ArchitecturePreview } from './ArchitecturePreview';
import { ArchitectureDrawingProgress, findArchitectureDrawing, statusText } from './ArchitectureDrawingProgress';
import { ArchitectureEditor } from './ArchitectureEditor';
import { architectureSummary } from './architectureTemplates';
import { DataPreview } from './DataPreview';
import { useEffect, useRef, useState } from 'react';
import type { FileRecord, ListResponse, TaskDetail, TaskArchitecture } from '@pixel/contracts';
import { isActiveRun } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { api, errorText, fileUrl } from './api';
import { MarkdownMessage } from './MarkdownMessage';
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

type Props = { taskId: string; view: Exclude<TaskView, 'chat'>; revision: number; conversations: Conversation[]; connections: Record<string, string>; onRefresh: () => Promise<void>; onChat: (id: string) => void; onCreateChat: (taskId: string) => Promise<void>; onGeneratePreview: (architecture: TaskArchitecture) => Promise<void>; previewAvailable: boolean };
export function TaskPanel({ taskId, view, revision, conversations, connections, onRefresh, onChat, onCreateChat, onGeneratePreview, previewAvailable }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [startingArchitecture, setStartingArchitecture] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const [shared, setShared] = useState<FileRecord[] | null>(null);
  const [reload, setReload] = useState(0);
  const [collapsedArchitectures, setCollapsedArchitectures] = useState(() => readCollapsedArchitectures(taskId));
  const uploadRef = useRef<HTMLInputElement>(null);
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
    <div className="task-panel-heading"><h1>{taskViewLabels[view]}</h1><span>{detail?.name}</span></div>
    {loading && !detail && <p role="status">正在读取任务资料…</p>}
    {(error || loadError) && <div className="workspace-error" role="alert">{error || loadError}<button onClick={() => { setError(''); setReload(value => value + 1); }}>重新读取</button></div>}
    {view === 'architecture' && <>
      <div className="panel-actions">
        <button className="action-button" disabled={pending || !!editing} onClick={() => setEditing({ id: 'new', name: '', description: '' })}><Plus />新建架构</button>
        {!!detail?.architectures.length && <>
          <button type="button" className="action-button" disabled={detail.architectures.every(architecture => !collapsedArchitectures.has(architecture.id))} onClick={() => setCollapsedArchitectures(new Set())}>全部展开</button>
          <button type="button" className="action-button" disabled={detail.architectures.every(architecture => collapsedArchitectures.has(architecture.id))} onClick={() => setCollapsedArchitectures(new Set(detail.architectures.map(architecture => architecture.id)))}>全部折叠</button>
        </>}
      </div>
      {editing && <ArchitectureEditor key={editing.id} initial={editing.id === 'new' ? undefined : editing} pending={pending} onCancel={() => setEditing(null)} onSave={async (name, description) => {
        if (pending) return;
        setPending(true); setError('');
        try {
          await api(`/tasks/${taskId}/architectures${editing.id === 'new' ? '' : `/${editing.id}`}`, { method: editing.id === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ name, description }) });
          setEditing(null);
          await onRefresh().catch(err => setError(`架构已保存，但刷新失败：${errorText(err)}`));
          setReload(value => value + 1);
        } finally { setPending(false); }
      }} />}
      {!loading && !detail?.architectures.length && <p className="task-empty">暂无架构。添加本次评估的架构；执行后使用过的架构快照也会列在这里。</p>}
      {detail?.architectures.map(architecture => {
        const starting = startingArchitecture === architecture.id;
        const drawing = starting ? undefined : findArchitectureDrawing(chats, architecture.id);
        const drawingActive = starting || !!(drawing && isActiveRun(drawing.run.status));
        const previewReady = !!drawing && !!architecture.previews?.some(preview => preview.file.conversationId === drawing.conversation.id && preview.createdAt >= drawing.run.createdAt);
        const collapsed = collapsedArchitectures.has(architecture.id);
        const bodyId = `architecture-body-${architecture.id}`;
        return <article className="task-record" key={architecture.id}>
        <div className="task-record-heading architecture-record-heading"><h2><button type="button" className="architecture-fold-toggle" aria-expanded={!collapsed} aria-controls={bodyId} aria-label={`${collapsed ? '展开' : '折叠'}架构：${architecture.name}`} onClick={() => toggleArchitecture(architecture.id)}>{collapsed ? <ChevronRight /> : <ChevronDown />}<span>{architecture.name}</span></button></h2>{architecture.sourceFile ? <span>已执行的架构快照</span> : <button className="action-button" disabled={pending || !!editing} onClick={() => setEditing({ id: architecture.id, name: architecture.name, description: architecture.description })}>编辑</button>}</div>
        {architectureSummary(architecture.description) && <p className="task-note">{architectureSummary(architecture.description)}</p>}
        {collapsed && <p className={drawing?.run.error ? 'error-text architecture-collapsed-status' : 'task-note architecture-collapsed-status'} role="status">
          {drawing || starting ? statusText(drawing?.run, starting, previewReady) : architecture.previews?.length ? `${architecture.previews.length} 份预览` : '尚无预览'}
          {drawingActive && drawing && connections[drawing.conversation.id] ? ` · ${connections[drawing.conversation.id]}` : ''}
          {drawing?.run.error ? ` · ${drawing.run.error}` : ''}
          {architecture.previewIssues?.length ? ' · 预览存在校验提示，请展开查看。' : ''}
        </p>}
        <div id={bodyId} className="architecture-record-body" hidden={collapsed}>{!collapsed && <>
        <div className="panel-actions"><button className="action-button" disabled={pending || !previewAvailable || drawingActive} onClick={() => {
          setStartingArchitecture(architecture.id);
          void action(() => onGeneratePreview(architecture)).finally(() => setStartingArchitecture(null));
        }}>{drawingActive ? 'Agent 正在绘制…' : architecture.previews?.length ? '让 Agent 重新绘制' : '让 Agent 绘制预览'}</button></div>
        <ArchitectureDrawingProgress key={starting ? 'starting' : drawing?.run.id ?? 'idle'} drawing={drawing} starting={starting} connection={drawing ? connections[drawing.conversation.id] : undefined} previewReady={previewReady} onOpenChat={onChat} />
        {architecture.previews?.length ? <ArchitecturePreview previews={architecture.previews} /> : <p className="task-empty">尚无预览，Agent 会为这份架构设计图形与布局。</p>}
        {architecture.previewIssues?.length ? <p className="task-note">{[...new Set(architecture.previewIssues)].join(' ')}</p> : null}
        <details><summary>架构定义</summary><pre className="architecture-definition">{architecture.description}</pre></details>
        {architecture.sourceConversationId && <button className="action-button" onClick={() => onChat(architecture.sourceConversationId!)}>查看来源聊天</button>}
        {architecture.sourceFile && downloads([architecture.sourceFile])}
        </>}</div>
      </article>; })}
    </>}
    {view === 'data' && <>
      <div className="panel-actions">
        <input hidden multiple type="file" ref={uploadRef} onChange={event => {
          const selected = Array.from(event.target.files ?? []); event.target.value = '';
          if (!selected.length) return;
          void action(async () => {
            for (const file of selected) {
              const form = new FormData(); form.append('file', file);
              const uploaded = await api<FileRecord>('/uploads', { method: 'POST', body: form });
              await api(`/tasks/${taskId}/files`, { method: 'POST', body: JSON.stringify({ fileId: uploaded.id }) });
            }
          });
        }} />
        <button className="action-button" disabled={pending} onClick={() => uploadRef.current?.click()}><Plus />上传数据</button>
        <button className="action-button" disabled={pending} onClick={() => void action(async () => setShared((await api<ListResponse<FileRecord>>('/uploads')).items))}>从已有上传添加</button>
      </div>
      <p className="task-note">同一任务下的聊天可以读取这些数据。</p>
      {!loading && !uploads.length && <p className="task-empty">暂无数据。上传文件或从已有上传中添加。</p>}
      {!!uploads.length && <DataPreview key={taskId} taskId={taskId} files={uploads} />}
      {downloads(uploads)}
      {shared && <section className="task-record"><div className="task-record-heading"><h2>已有上传</h2><button className="action-button" onClick={() => setShared(null)}>收起</button></div>
        <ul className="task-files">{shared.map(file => <li key={file.id}><span>{file.name}</span><button className="action-button" disabled={pending || uploads.some(upload => upload.id === file.id)} onClick={() => void action(() => api(`/tasks/${taskId}/files`, { method: 'POST', body: JSON.stringify({ fileId: file.id }) }))}>{uploads.some(upload => upload.id === file.id) ? '已添加' : '添加'}</button></li>)}</ul>
        {!shared.length && <p className="task-empty">暂无可用上传</p>}
      </section>}
    </>}
    {view === 'conclusions' && <>
      {!loading && !artifacts.length && <p className="task-empty">暂无执行产物。</p>}
      {chats.map(chat => {
        const files = artifacts.filter(file => file.conversationId === chat.id);
        if (!files.length) return null;
        const reports = detail?.reports.filter(report => files.some(file => file.id === report.fileId)) ?? [];
        const reply = groupReplyMessages(chat.messages).filter(message => message.role === 'assistant' && message.text).at(-1);
        return <article className="task-record" key={chat.id}>
          <div className="task-record-heading"><h2>{chat.title}</h2><button className="action-button" onClick={() => onChat(chat.id)}>打开聊天</button></div>
          {reports.map(report => <details className="task-conclusion" open key={report.fileId}><summary>{files.find(file => file.id === report.fileId)?.name}</summary><MarkdownMessage text={report.text} /></details>)}
          {!reports.length && reply && <details className="task-conclusion" open><summary>最近回复</summary><MarkdownMessage text={reply.text} /></details>}
          <details open><summary>执行产物（{files.length}）</summary>{downloads(files)}</details>
        </article>;
      })}
    </>}
    <div className="panel-actions"><button className="action-button" disabled={pending} onClick={() => void action(() => onCreateChat(taskId))}><Plus />新建聊天</button></div>
  </section>;
}
