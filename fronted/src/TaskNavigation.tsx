import { localizeMessage, t } from './i18n';
import { useEffect, useState } from 'react';
import { isActiveRun, type EvaluationTask, type Run } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { BarChart, ChevronDown, ChevronRight, Chip, Ellipsis, Folder, MessageSquare, Plus, Repair } from './PixelIcons';
import { errorText } from './api';
import { DeleteChatButton } from './DeleteChatButton';

export type TaskView = 'chat' | 'architecture' | 'data' | 'repair' | 'conclusions';
export const taskViewLabels = { get chat() { return t("聊天"); }, get architecture() { return t("架构"); }, get data() { return t("数据"); }, get repair() { return t("任务求解"); }, get conclusions() { return t("执行结论"); } };
type Props = {
  tasks: EvaluationTask[]; conversations: Conversation[]; runs: Record<string, Run>;
  activeTaskId: string; activeChatId: string; view: TaskView; disabled: boolean; loading: boolean;
  onView: (taskId: string, view: TaskView) => void;
  onChat: (id: string) => void; onCreateChat: (taskId: string) => Promise<void>;
  onCreateTask: (name: string) => Promise<void>; onRenameTask: (id: string, name: string) => Promise<void>;
  onLoadDemo: () => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
};
export function TaskNavigation(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [actionTask, setActionTask] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [demoPending, setDemoPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (props.activeTaskId) setExpanded(prev => new Set(prev).add(props.activeTaskId)); }, [props.activeTaskId]);
  useEffect(() => {
    if (!actionTask) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-task-actions]')) setActionTask(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setActionTask(null);
      document.getElementById(`task-actions-toggle-${actionTask}`)?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [actionTask]);
  const disabled = props.disabled || pending;
  const edit = (id: string, value: string) => { setActionTask(null); setDeletingTask(null); setEditing(id); setName(value); setError(''); };
  const form = (id: string) => editing === id && <form className="task-name-form" onSubmit={async event => {
    event.preventDefault(); if (disabled || !name.trim()) return; setPending(true); setError('');
    try { if (id === 'new') await props.onCreateTask(name.trim()); else await props.onRenameTask(id, name.trim()); setEditing(null); }
    catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }}>
    <input autoFocus aria-label={id === 'new' ? t("新任务名称") : t("任务名称")} placeholder={t("输入任务名")} required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={pending} />
    <div><button className="action-button" disabled={disabled || !name.trim()}>{t("保存")}</button><button type="button" className="action-button" disabled={pending} onClick={() => setEditing(null)}>{t("取消")}</button></div>
    {error && <p role="alert">{localizeMessage(error)}</p>}
  </form>;
  return <>
    <button className="new-chat" disabled={disabled} onClick={() => edit('new', '')}><Plus /><span>{t("新建任务")}</span></button>
    <button className="search-trigger" disabled={disabled} onClick={async () => {
      if (disabled) return;
      setPending(true); setDemoPending(true); setError('');
      try { await props.onLoadDemo(); }
      catch (err) { setError(errorText(err)); }
      finally { setPending(false); setDemoPending(false); }
    }}><Chip /><span>{demoPending ? t('正在加载 DEJOA demo…') : t('加载 DEJOA demo')}</span></button>
    {form('new')}
    <nav className="task-list" aria-label={t("评估任务")}>
      {props.tasks.map(task => {
        const open = expanded.has(task.id);
        const chats = props.conversations.filter(c => c.taskId === task.id).sort((a, b) => b.updated - a.updated);
        const taskBusy = chats.some(chat => isActiveRun((props.runs[chat.id] ?? chat.activeRun)?.status ?? 'completed'));
        return <section className={`task-group ${props.activeTaskId === task.id ? 'current-task' : ''}`} key={task.id}>
          <div className="task-heading">
            <button className="task-name" aria-expanded={open} title={task.name} onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>
              {open ? <ChevronDown /> : <ChevronRight />}<span>{task.name}</span>{taskBusy && <RunBadge />}
            </button>
            <button data-task-actions id={`task-actions-toggle-${task.id}`} className="icon-button" aria-label={t("任务操作：{0}", task.name)} title={t("任务操作")} aria-expanded={actionTask === task.id} aria-controls={`task-actions-${task.id}`} disabled={disabled} onClick={() => setActionTask(previous => previous === task.id ? null : task.id)}><Ellipsis /></button>
          </div>
          {actionTask === task.id && <div data-task-actions id={`task-actions-${task.id}`} className="task-actions-menu" role="group" aria-label={t("任务操作：{0}", task.name)}>
            <button className="action-button" disabled={disabled} onClick={() => edit(task.id, task.name)}>{t("重命名")}</button>
            <button className="action-button delete-task" disabled={disabled} onClick={() => { setActionTask(null); setEditing(null); setError(''); setDeletingTask(task.id); }}>{t("删除任务")}</button>
          </div>}
          {form(task.id)}
          {deletingTask === task.id && <div className="task-delete-confirm" role="group" aria-label={t("确认删除任务：{0}", task.name)}>
            <p>{t("删除“")}{task.name}{t("”及其全部聊天？共享产品和 wafer 数据保留。")}</p>
            {taskBusy && <p className="error-text">{t("请先停止任务中正在执行的聊天。")}</p>}
            {error && <p className="error-text" role="alert">{localizeMessage(error)}</p>}
            <div><button type="button" className="action-button delete-task" disabled={disabled || taskBusy} onClick={async () => {
              if (disabled || taskBusy) return;
              setPending(true); setError('');
              try {
                await props.onDeleteTask(task.id); setDeletingTask(null);
                setExpanded(previous => { const next = new Set(previous); next.delete(task.id); return next; });
              } catch (err) { setError(errorText(err)); } finally { setPending(false); }
            }}>{pending ? t("正在删除…") : t("确认删除")}</button><button type="button" className="action-button" disabled={pending} onClick={() => { setDeletingTask(null); setError(''); }}>{t("取消")}</button></div>
          </div>}
          {open && <div className="task-children">
            {([{ view: 'architecture', icon: Chip }, { view: 'data', icon: Folder }, { view: 'repair', icon: Repair }, { view: 'conclusions', icon: BarChart }] as const).map(item => <button
              key={item.view} className={`task-resource ${props.activeTaskId === task.id && props.view === item.view ? 'selected' : ''}`}
              aria-current={props.activeTaskId === task.id && props.view === item.view ? 'page' : undefined}
              disabled={props.disabled}
              title={taskViewLabels[item.view]}
              onClick={() => props.onView(task.id, item.view)}><item.icon /><span>{taskViewLabels[item.view]}</span>
            </button>)}
            <div className="task-chat-heading"><span>{t("聊天")}</span><button className="icon-button" disabled={disabled} aria-label={t("在 {0} 中新建聊天", task.name)} onClick={async () => {
              setPending(true); setError(''); try { await props.onCreateChat(task.id); } catch (err) { setError(errorText(err)); } finally { setPending(false); }
            }}><Plus /></button></div>
            {chats.map(chat => <div className={`history-item ${props.view === 'chat' && props.activeChatId === chat.id ? 'selected' : ''}`} key={chat.id}>
              <button disabled={props.disabled} title={chat.title} aria-current={props.view === 'chat' && props.activeChatId === chat.id ? 'page' : undefined} onClick={() => props.onChat(chat.id)}>
                <MessageSquare /><span>{chat.title}</span>{isActiveRun((props.runs[chat.id] ?? chat.activeRun)?.status ?? 'completed') && <RunBadge />}
              </button>
              <DeleteChatButton title={chat.title} disabled={disabled} onDelete={() => void props.onDeleteChat(chat.id)} />
            </div>)}
            {!chats.length && <p className="history-empty">{t("暂无聊天")}</p>}
          </div>}
        </section>;
      })}
      {!props.tasks.length && <p className="history-empty" role={props.loading ? 'status' : undefined}>{props.loading ? t("正在读取任务…") : t("暂无任务")}</p>}
      {error && editing === null && deletingTask === null && <p role="alert" className="error-text">{localizeMessage(error)}</p>}
    </nav>
  </>;
}

export function RunBadge() {
  return <span className="run-badge" role="img" aria-label={t("运行中")} title={t("运行中")} />;
}
