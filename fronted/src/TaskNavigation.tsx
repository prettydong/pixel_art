import { useEffect, useState } from 'react';
import { isActiveRun, type EvaluationTask, type Run } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { BarChart, ChevronDown, ChevronRight, Chip, Ellipsis, Folder, MessageSquare, Plus, Trash2 } from './PixelIcons';
import { errorText } from './api';

export type TaskView = 'chat' | 'architecture' | 'data' | 'conclusions';
export const taskViewLabels = { chat: '聊天', architecture: '架构', data: '数据', conclusions: '执行结论' };
type Props = {
  tasks: EvaluationTask[]; conversations: Conversation[]; runs: Record<string, Run>;
  activeTaskId: string; activeChatId: string; view: TaskView; disabled: boolean;
  onView: (taskId: string, view: TaskView) => void;
  onChat: (id: string) => void; onCreateChat: (taskId: string) => Promise<void>;
  onCreateTask: (name: string) => Promise<void>; onRenameTask: (id: string, name: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
};
export function TaskNavigation(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (props.activeTaskId) setExpanded(prev => new Set(prev).add(props.activeTaskId)); }, [props.activeTaskId]);
  const disabled = props.disabled || pending;
  const edit = (id: string, value: string) => { setEditing(id); setName(value); setError(''); };
  const form = (id: string) => editing === id && <form className="task-name-form" onSubmit={async event => {
    event.preventDefault(); if (disabled || !name.trim()) return; setPending(true); setError('');
    try { if (id === 'new') await props.onCreateTask(name.trim()); else await props.onRenameTask(id, name.trim()); setEditing(null); }
    catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }}>
    <input autoFocus aria-label={id === 'new' ? '新任务名称' : '任务名称'} placeholder="输入任务名" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={pending} />
    <div><button className="action-button" disabled={disabled || !name.trim()}>保存</button><button type="button" className="action-button" disabled={pending} onClick={() => setEditing(null)}>取消</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
  return <>
    <button className="new-chat" disabled={disabled} onClick={() => edit('new', '')}><Plus /><span>新建任务</span></button>
    {form('new')}
    <nav className="task-list" aria-label="评估任务">
      {props.tasks.map(task => {
        const open = expanded.has(task.id);
        const chats = props.conversations.filter(c => c.taskId === task.id).sort((a, b) => b.updated - a.updated);
        return <section className={`task-group ${props.activeTaskId === task.id ? 'current-task' : ''}`} key={task.id}>
          <div className="task-heading">
            <button className="task-name" aria-expanded={open} title={task.name} onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>
              {open ? <ChevronDown /> : <ChevronRight />}<span>{task.name}</span>
            </button>
            <button className="icon-button" aria-label={`重命名任务：${task.name}`} disabled={disabled} onClick={() => edit(task.id, task.name)}><Ellipsis /></button>
          </div>
          {form(task.id)}
          {open && <div className="task-children">
            {([{ view: 'architecture', icon: Chip }, { view: 'data', icon: Folder }, { view: 'conclusions', icon: BarChart }] as const).map(item => <button
              key={item.view} className={`task-resource ${props.activeTaskId === task.id && props.view === item.view ? 'selected' : ''}`}
              aria-current={props.activeTaskId === task.id && props.view === item.view ? 'page' : undefined}
              disabled={props.disabled || (item.view === 'conclusions' && !task.artifactCount)}
              title={item.view === 'conclusions' && !task.artifactCount ? '暂无执行产物' : taskViewLabels[item.view]}
              onClick={() => props.onView(task.id, item.view)}><item.icon /><span>{taskViewLabels[item.view]}</span>
            </button>)}
            <div className="task-chat-heading"><span>聊天</span><button className="icon-button" disabled={disabled} aria-label={`在 ${task.name} 中新建聊天`} onClick={async () => {
              setPending(true); setError(''); try { await props.onCreateChat(task.id); } catch (err) { setError(errorText(err)); } finally { setPending(false); }
            }}><Plus /></button></div>
            {chats.map(chat => <div className={`history-item ${props.view === 'chat' && props.activeChatId === chat.id ? 'selected' : ''}`} key={chat.id}>
              <button disabled={props.disabled} title={chat.title} aria-current={props.view === 'chat' && props.activeChatId === chat.id ? 'page' : undefined} onClick={() => props.onChat(chat.id)}>
                <MessageSquare /><span>{chat.title}{(chat.activeRun || (props.runs[chat.id] && isActiveRun(props.runs[chat.id].status))) ? ' · 运行中' : ''}</span>
              </button>
              <button className="delete-chat" disabled={disabled} aria-label={`删除对话：${chat.title}`} onClick={() => props.onDeleteChat(chat.id)}><Trash2 /></button>
            </div>)}
            {!chats.length && <p className="history-empty">暂无聊天</p>}
          </div>}
        </section>;
      })}
      {!props.tasks.length && <p className="history-empty">暂无任务</p>}
      {error && editing === null && <p role="alert" className="error-text">{error}</p>}
    </nav>
  </>;
}
