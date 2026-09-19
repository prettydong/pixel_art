import { useMemo, useState, type ReactNode } from 'react';
import type { ToolCall } from '@pixel/contracts';
import type { ReplyMessage } from './replyMessages';
import { MarkdownMessage } from './MarkdownMessage';
import { Chip, ChevronDown, ChevronRight } from './PixelIcons';
import { chartTools, readChartTool } from '@pixel/contracts/charts';
import { PixelChart } from './PixelChart';

function ProcessDetails({ label, children, className = '', keepMounted = false }: { label: ReactNode; children: ReactNode; className?: string; keepMounted?: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className={`reply-details ${className}`} onToggle={event => {
    // Nested details must not change the outer fold's indicator or state.
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{open ? <ChevronDown /> : <ChevronRight />}{label}</summary>
    <div className="reply-details-body">{(open || keepMounted) && children}</div>
  </details>;
}

function ToolDetails({ tool, pending }: { tool: ToolCall; pending: boolean }) {
  const status = tool.status === 'running' ? (pending ? '执行中' : '已中断') : tool.status === 'completed' ? '完成' : tool.status === 'failed' ? '失败' : '已中断';
  return <ProcessDetails className="inline-tool" label={<><Chip /><span className="tool-name">{tool.name}</span><span className={tool.status === 'failed' ? 'error-text' : ''}>{status}</span>{tool.durationMs !== undefined && <span>{(tool.durationMs / 1000).toFixed(1)} s</span>}</>}>
    {tool.input !== undefined && <div><div className="detail-label">调用参数</div><pre>{tool.input}</pre></div>}
    {tool.text !== undefined && <div><div className="detail-label">{tool.status === 'running' && pending ? '实时输出' : '执行结果'}</div><pre>{tool.text || '工具未返回文本输出。'}</pre></div>}
    {tool.text === undefined && <p className="detail-label">{tool.status === 'running' && pending ? '等待工具输出…' : '没有可用的执行输出记录。'}</p>}
  </ProcessDetails>;
}

type ReplySegment = NonNullable<ReplyMessage['segments']>[number];
type ProcessItem =
  | { kind: 'reasoning'; key: string; segment: ReplySegment }
  | { kind: 'tool'; key: string; tool: ToolCall };
type ReplyBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'chart'; key: string; tool: ToolCall }
  | { kind: 'process'; key: string; items: ProcessItem[] };

/** Group adjacent process entries across model rounds; prose breaks the group. */
function replyBlocks(message: ReplyMessage): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  const appendProcess = (item: ProcessItem) => {
    const previous = blocks[blocks.length - 1];
    if (previous?.kind === 'process') previous.items.push(item);
    else blocks.push({ kind: 'process', key: item.key, items: [item] });
  };
  for (const segment of message.segments ?? [message]) {
    if (segment.reasoning) appendProcess({ kind: 'reasoning', key: `${segment.id}:reasoning`, segment });
    if (segment.text.trim()) blocks.push({ kind: 'text', key: `${segment.id}:text`, text: segment.text });
    for (const tool of segment.toolCalls ?? []) {
      appendProcess({ kind: 'tool', key: `${segment.id}:tool:${tool.id}`, tool });
      if (tool.status === 'completed' && Object.hasOwn(chartTools, tool.name)) blocks.push({ kind: 'chart', key: `${segment.id}:chart:${tool.id}`, tool });
    }
  }
  return blocks;
}

function ProcessGroup({ items, pending }: { items: ProcessItem[]; pending: boolean }) {
  const reasoningCount = items.filter(item => item.kind === 'reasoning').length;
  const tools = items.flatMap(item => item.kind === 'tool' ? [item.tool] : []);
  const failed = tools.filter(tool => tool.status === 'failed').length;
  const interrupted = tools.filter(tool => tool.status === 'interrupted' || (!pending && tool.status === 'running')).length;
  const running = pending && items.some(item => item.kind === 'tool' ? item.tool.status === 'running' : !item.segment.generation?.finished);
  return <ProcessDetails className="process-group" keepMounted label={<>
    <span className="process-group-title">思考与工具</span>
    {reasoningCount > 0 && <span>{reasoningCount} 段思考</span>}
    {tools.length > 0 && <span>{tools.length} 次调用</span>}
    {running && <span className="process-group-status">进行中</span>}
    {failed > 0 && <span className="error-text">{failed} 次失败</span>}
    {interrupted > 0 && <span>{interrupted} 次中断</span>}
  </>}>
    {items.map(item => item.kind === 'tool'
      ? <ToolDetails key={item.key} tool={item.tool} pending={pending} />
      : <ProcessDetails key={item.key} className="reasoning-details" label={<span>思考过程{pending && !item.segment.generation?.finished ? ' · 生成中' : ''}</span>}>
        <p className="detail-label">模型返回的思考内容</p>
        <MarkdownMessage text={item.segment.reasoning!} />
      </ProcessDetails>)}
  </ProcessDetails>;
}

function GenerationStats({ message }: { message: ReplyMessage }) {
  const generations = (message.segments ?? [message]).flatMap(segment => segment.generation ? [segment.generation] : []);
  if (!generations.length) return null;
  const tokens = generations.reduce((sum, generation) => sum + generation.outputTokens, 0);
  // Both timestamps come from the server; browser clock skew and SSE replay
  // must not alter throughput. Refresh at each generation event.
  const duration = generations.reduce((sum, generation) => sum + Math.max(0, generation.updatedAt - generation.startedAt), 0);
  const estimated = generations.some(generation => generation.estimated);
  const speed = tokens > 0 && duration > 0 ? (tokens / (duration / 1000)).toFixed(1) : '—';
  return <div className="generation-stats" title="平均速度 = 输出 token / 模型调用耗时。包含首 token 等待，排除工具执行耗时；无用量统计时按字符估算，最终以模型返回为准。">
    <span>{estimated ? '估算 ' : ''}{speed} token/s</span>
    <span>{estimated ? '约 ' : ''}{tokens.toLocaleString()} token</span>
    <span>模型耗时 {(duration / 1000).toFixed(1)} s</span>
  </div>;
}

export function StreamingReply({ message, pending }: { message: ReplyMessage; pending: boolean }) {
  return <div className="reply-flow">
    {replyBlocks(message).map(block => block.kind === 'text'
      ? <MarkdownMessage key={block.key} text={block.text} />
      : block.kind === 'chart' ? <ChartResult key={block.key} tool={block.tool} />
      : <ProcessGroup key={block.key} items={block.items} pending={pending} />)}
    <GenerationStats message={message} />
    {pending && <span className="typing-dots" role="status" aria-label="正在回复"><i /><i /><i /></span>}
  </div>;
}

function ChartResult({ tool }: { tool: ToolCall }) {
  const chart = useMemo(() => readChartTool(tool), [tool.name, tool.status, tool.text]);
  return chart ? <PixelChart chart={chart} /> : <p className="pixel-chart-unavailable">图表数据无效或不完整，请查看工具详情或让 agent 重新生成。</p>;
}
