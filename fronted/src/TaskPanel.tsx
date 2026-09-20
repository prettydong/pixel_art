import { ArchitecturePreview } from './ArchitecturePreview';
import { useEffect, useRef, useState } from 'react';
import type { FileRecord, ListResponse, TaskDetail, TaskArchitecture } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { api, errorText, fileUrl } from './api';
import { MarkdownMessage } from './MarkdownMessage';
import { groupReplyMessages } from './replyMessages';
import { Download, Plus } from './PixelIcons';
import { taskViewLabels, type TaskView } from './TaskNavigation';

type Props = { taskId: string; view: Exclude<TaskView, 'chat'>; revision: number; conversations: Conversation[]; onRefresh: () => Promise<void>; onChat: (id: string) => void; onCreateChat: (taskId: string) => Promise<void>; onGeneratePreview: (architecture: TaskArchitecture) => Promise<void>; previewAvailable: boolean };
export function TaskPanel({ taskId, view, revision, conversations, onRefresh, onChat, onCreateChat, onGeneratePreview, previewAvailable }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState<FileRecord[] | null>(null);
  const [reload, setReload] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true; setLoading(true);
    api<TaskDetail>(`/tasks/${taskId}`).then(result => { if (alive) { setDetail(result); setLoadError(''); } })
      .catch(err => { if (alive) setLoadError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [taskId, revision, reload]);
  async function action(work: () => Promise<unknown>) {
    if (pending) return; setPending(true); setError('');
    try { await work(); }
    catch (err) { setError(errorText(err)); }
    finally { await onRefresh(); setReload(value => value + 1); setPending(false); }
  }
  const uploads = detail?.files.filter(file => file.kind === 'upload') ?? [];
  const artifacts = detail?.files.filter(file => file.kind === 'artifact') ?? [];
  const chats = conversations.filter(chat => chat.taskId === taskId);
  const isDrawing = (id: string) => chats.some(chat => chat.activeRun && chat.messages.some(message => message.role === 'user' && message.text.includes(id)));
  const downloads = (files: FileRecord[]) => <ul className="task-files">{files.map(file => <li key={file.id}><a href={fileUrl(file)} download><Download /><span>{file.name}</span></a></li>)}</ul>;
  return <section className="task-panel" aria-label={taskViewLabels[view]} aria-busy={loading || pending}>
    <div className="task-panel-heading"><h1>{taskViewLabels[view]}</h1><span>{detail?.name}</span></div>
    {loading && !detail && <p role="status">正在读取任务资料…</p>}
    {(error || loadError) && <div className="workspace-error" role="alert">{error || loadError}<button onClick={() => { setError(''); setReload(value => value + 1); }}>重新读取</button></div>}
    {view === 'architecture' && <>
      <div className="panel-actions"><button className="action-button" disabled={pending} onClick={() => { setEditing('new'); setName(''); setDescription(''); }}><Plus />添加架构</button></div>
      {editing && <form className="task-architecture-form account-form" onSubmit={event => {
        event.preventDefault(); void action(async () => {
          await api(`/tasks/${taskId}/architectures${editing === 'new' ? '' : `/${editing}`}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
          setEditing(null);
        });
      }}>
        <label>架构名称<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={pending} placeholder="例如：8组列冗余方案" /></label>
        <label>架构定义<textarea required maxLength={30000} rows={8} value={description} onChange={event => setDescription(event.target.value)} disabled={pending} placeholder="填写阵列规模、备用行列、资源共享范围与约束；也可以粘贴 JSON。" /></label>
        <div className="panel-actions"><button className="action-button" disabled={pending || !name.trim() || !description.trim()}>保存架构</button><button className="action-button" type="button" disabled={pending} onClick={() => setEditing(null)}>取消</button></div>
      </form>}
      {!loading && !detail?.architectures.length && <p className="task-empty">暂无架构。添加本次评估的架构；执行后使用过的架构快照也会列在这里。</p>}
      {detail?.architectures.map(architecture => <article className="task-record" key={architecture.id}>
        <div className="task-record-heading"><h2>{architecture.name}</h2>{architecture.sourceFile ? <span>已执行的架构快照</span> : <button className="action-button" disabled={pending} onClick={() => { setEditing(architecture.id); setName(architecture.name); setDescription(architecture.description); }}>编辑</button>}</div>
        <div className="panel-actions"><button className="action-button" disabled={pending || !previewAvailable || isDrawing(architecture.id)} onClick={() => void action(() => onGeneratePreview(architecture))}>{isDrawing(architecture.id) ? 'Agent 正在绘制…' : architecture.previews?.length ? '让 Agent 重新绘制' : '让 Agent 绘制预览'}</button></div>
        {architecture.previews?.length ? <ArchitecturePreview previews={architecture.previews} /> : <p className="task-empty">尚无预览，Agent 会为这份架构设计图形与布局。</p>}
        {architecture.previewIssues?.length ? <p className="task-note">{[...new Set(architecture.previewIssues)].join(' ')}</p> : null}
        <details><summary>架构定义</summary><pre className="architecture-definition">{architecture.description}</pre></details>
        {architecture.sourceConversationId && <button className="action-button" onClick={() => onChat(architecture.sourceConversationId!)}>查看来源聊天</button>}
        {architecture.sourceFile && downloads([architecture.sourceFile])}
      </article>)}
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
