import { useEffect, useMemo, useRef, useState } from 'react';
import { isActiveRun, type Run, type ToolCall } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import './ArchitectureDrawingProgress.css';

export type ArchitectureDrawing = { conversation: Conversation; run: Run };

const drawingPrompt = '请为当前任务中的架构 ';

/** Locate the run from its immutable prompt rather than the editable chat title. */
export function findArchitectureDrawing(conversations: Conversation[], architectureId?: string): ArchitectureDrawing | undefined {
  const candidates = conversations.flatMap(conversation => {
    const run = conversation.activeRun ?? conversation.lastRun;
    if (!run) return [];
    const promptMatches = conversation.messages.some(message =>
      message.role === 'user' && message.runId === run.id && message.text.startsWith(drawingPrompt)
      && message.text.includes('架构预览')
      && (!architectureId || message.text.includes(`（ID：${architectureId}，`)));
    return promptMatches ? [{ conversation, run }] : [];
  });
  return candidates.sort((left, right) => {
    const activeDifference = Number(isActiveRun(right.run.status)) - Number(isActiveRun(left.run.status));
    return activeDifference || right.run.createdAt - left.run.createdAt;
  })[0];
}

function tail(value: string, maximum: number) {
  return value.length <= maximum ? value : `…${value.slice(-maximum)}`;
}

export function statusText(run: Run | undefined, starting: boolean, previewReady: boolean) {
  if (!run) return starting ? '正在启动绘制 Agent…' : '等待绘制任务';
  switch (run.status) {
    case 'starting': return 'Agent 正在启动绘制…';
    case 'running': return 'Agent 正在绘制…';
    case 'cancelling': return 'Agent 正在取消…';
    case 'completed': return previewReady ? '预览已生成' : 'Agent 已结束，尚未发现有效预览；请查看绘制聊天。';
    case 'failed': return 'Agent 绘制失败';
    case 'cancelled': return 'Agent 已取消';
    case 'interrupted': return 'Agent 已中断';
  }
}

function toolStatus(tool: ToolCall, active: boolean) {
  if (tool.status === 'running') return active ? '执行中' : '已中断';
  if (tool.status === 'completed') return '完成';
  if (tool.status === 'failed') return '失败';
  return '已中断';
}

function elapsedText(createdAt: number, now: number) {
  const total = Math.max(0, Math.floor((now - createdAt) / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes ? `${minutes} 分 ` : ''}${total % 60} 秒`;
}

function assistantMessages(conversation: Conversation | undefined, runId: string | undefined) {
  return (conversation?.messages ?? []).filter(message => message.role === 'assistant' && message.runId === runId);
}

export function ArchitectureDrawingProgress({ drawing, starting = false, connection, previewReady, onOpenChat }: {
  drawing?: ArchitectureDrawing;
  starting?: boolean;
  connection?: string;
  previewReady: boolean;
  onOpenChat: (id: string) => void;
}) {
  const run = drawing?.run;
  const active = !!run && isActiveRun(run.status);
  const [now, setNow] = useState(Date.now());
  const startedLocally = useRef(Date.now());
  const [following, setFollowing] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => assistantMessages(drawing?.conversation, run?.id), [drawing?.conversation, run?.id]);
  const visibleText = useMemo(() => tail(messages.map(message => message.text).filter(Boolean).join('\n\n'), 6000), [messages]);
  const hasGenerationOnly = messages.some(message => !!message.reasoning || (!!message.generation && !message.generation.finished));
  const tools = useMemo(() => messages.flatMap((message, messageIndex) => (message.toolCalls ?? []).map((tool, toolIndex) => ({ tool, messageIndex, toolIndex })))
    .sort((left, right) => (left.tool.updatedAt ?? 0) - (right.tool.updatedAt ?? 0) || left.messageIndex - right.messageIndex || left.toolIndex - right.toolIndex)
    .slice(-6), [messages]);

  useEffect(() => {
    if (!active && !starting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, starting, run?.id]);

  useEffect(() => {
    const output = outputRef.current;
    if (output && following) output.scrollTop = output.scrollHeight;
  }, [following, visibleText, tools]);

  const observeScroll = () => {
    const output = outputRef.current;
    if (!output) return;
    setFollowing(output.scrollHeight - output.scrollTop - output.clientHeight <= 2);
  };
  const follow = () => { setFollowing(true); outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }); };
  const state = statusText(run, starting, previewReady);
  const error = run?.error;
  const noVisibleOutput = !visibleText && !tools.length;
  if (!drawing && !starting) return null;

  return <section className="architecture-drawing-progress" aria-label="Agent 绘制进度" aria-busy={starting || active}>
    <div className="architecture-drawing-progress-heading">
      <div><h3>Agent 绘制进度</h3><p role="status" className={run?.status === 'failed' ? 'error-text' : 'architecture-drawing-status'}>{state}</p></div>
      {run && <span className="architecture-drawing-elapsed">已用时 {elapsedText(run.createdAt, active ? now : (run.finishedAt ?? run.createdAt))}</span>}
      {!run && starting && <span className="architecture-drawing-elapsed">已等待 {elapsedText(startedLocally.current, now)}</span>}
    </div>
    {(connection || error) && <div className="architecture-drawing-meta">
      {connection && <span>连接：{connection}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>}
    <div className="architecture-drawing-output" ref={outputRef} onScroll={observeScroll} tabIndex={0} role="log" aria-live="off" aria-label="Agent 绘制输出">
      {visibleText && <div className="architecture-drawing-text">{visibleText}</div>}
      {!visibleText && hasGenerationOnly && active && <p className="architecture-drawing-waiting">模型正在生成，等待可展示的文字或工具结果…</p>}
      {noVisibleOutput && (!hasGenerationOnly || !active) && <p className="architecture-drawing-waiting">{active || starting ? '等待首段输出…' : '本次执行没有可展示的文字输出。'}</p>}
      {tools.map(({ tool }, index) => <details className="architecture-drawing-tool" key={tool.id} open={tool.status === 'failed' || (active && index === tools.length - 1)}>
        <summary><span>{tool.name}</span><span className={tool.status === 'failed' ? 'error-text' : ''}>{toolStatus(tool, active)}</span></summary>
        {tool.text !== undefined ? <pre>{tail(tool.text, 1000) || '工具未返回文本输出。'}</pre> : <p>没有可用的工具输出。</p>}
      </details>)}
    </div>
    <p className="architecture-drawing-waiting">仅展示最近文字及 6 次工具调用；完整过程见绘制聊天。</p>
    {!following && <button type="button" className="action-button architecture-drawing-follow" onClick={follow}>继续跟随输出</button>}
    {drawing && <button type="button" className="action-button" onClick={() => onOpenChat(drawing.conversation.id)}>查看绘制聊天</button>}
  </section>;
}
