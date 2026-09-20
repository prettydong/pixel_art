import { useCallback, useEffect, useRef, useState } from 'react';
import { isActiveRun, type Conversation, type Message, type ModelOption, type Run, type RunEvent, type ListResponse, type EvaluationTask } from '@pixel/contracts';
import { api, apiUrl, errorText, RequestError } from './api';
import { mergeMessage } from './replyMessages';
export function useWorkspace(enabled = true) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [connections, setConnections] = useState<Record<string, string>>({});
  const streams = useRef(new Map<string, { source: EventSource; run: Run }>());
  const latestRuns = useRef(new Map<string, Run>());
  const removed = useRef(new Set<string>());
  const mounted = useRef(true);
  const updateRun = useCallback((run: Run) => {
    if (!mounted.current || removed.current.has(run.conversationId)) return false;
    const previous = latestRuns.current.get(run.conversationId);
    if (previous && previous.id !== run.id && previous.createdAt > run.createdAt) return false;
    latestRuns.current.set(run.conversationId, run);
    setRuns(prev => ({ ...prev, [run.conversationId]: run }));
    setConversations(prev => prev.map(c => c.id === run.conversationId ? { ...c, activeRun: isActiveRun(run.status) ? run : null, lastRun: run } : c));
    return true;
  }, []);
  const upsert = useCallback((conversation: Conversation) => {
    if (removed.current.has(conversation.id)) return;
    const latest = latestRuns.current.get(conversation.id);
    if (latest && conversation.lastRun && latest.id !== conversation.lastRun.id && latest.createdAt >= conversation.lastRun.createdAt) return;
    setConversations(prev => prev.some(c => c.id === conversation.id) ? prev.map(c => {
      if (c.id !== conversation.id) return c;
      if (!latest || !isActiveRun(latest.status)) return conversation;
      // A concurrent HTTP snapshot must not roll back text already streamed.
      const messages = conversation.messages.map(message => {
        const existing = c.messages.find(item => item.id === message.id);
        return mergeMessage(existing, message);
      });
      for (const message of c.messages) if (!messages.some(item => item.id === message.id)) messages.push(message);
      return { ...conversation, messages };
    }) : [conversation, ...prev]);
  }, []);
  const refresh = useCallback(async (id: string) => {
    const conversation = await api<Conversation>(`/conversations/${id}`);
    if (mounted.current && !removed.current.has(id)) upsert(conversation);
    return conversation;
  }, [upsert]);
  const forget = useCallback((id: string) => {
    removed.current.add(id); latestRuns.current.delete(id);
    streams.current.forEach((entry, key) => { if (entry.run.conversationId === id) { entry.source.close(); streams.current.delete(key); } });
    setConversations(prev => prev.filter(c => c.id !== id));
    setRuns(prev => { const next = { ...prev }; delete next[id]; return next; });
  }, []);
  const attach = useCallback((run: Run) => {
    if (removed.current.has(run.conversationId) || streams.current.has(run.id) || !updateRun(run)) return;
    if (!isActiveRun(run.status)) return;
    // Keep at most one SSE per tab to leave shared HTTP/1 slots for API calls.
    // Evicted/background runs continue on the server and are polled below.
    while (streams.current.size >= 1) {
      const oldest = streams.current.entries().next().value;
      if (!oldest) break;
      oldest[1].source.close(); streams.current.delete(oldest[0]);
      setConnections(prev => ({ ...prev, [oldest[1].run.conversationId]: '后台更新（每 3 秒）' }));
    }
    const source = new EventSource(apiUrl(`/runs/${run.id}/events?after=0`));
    streams.current.set(run.id, { source, run });
    let cursor = 0;
    let checking = false;
    const replay = new Map<string, Message>();
    const live = () => mounted.current && !removed.current.has(run.conversationId) && streams.current.get(run.id)?.source === source && latestRuns.current.get(run.conversationId)?.id === run.id;
    const finish = (current: Run) => {
      if (!live()) return;
      updateRun(current); source.close(); streams.current.delete(run.id);
      setConnections(prev => ({ ...prev, [run.conversationId]: '' }));
      void refresh(run.conversationId).catch(e => { if (!removed.current.has(run.conversationId)) setError(errorText(e)); });
    };
    source.onopen = () => { if (live()) setConnections(prev => ({ ...prev, [run.conversationId]: '已连接' })); };
    source.onerror = () => {
      if (!live()) { source.close(); return; }
      setConnections(prev => ({ ...prev, [run.conversationId]: '连接断开，正在重连…' }));
      if (checking) return;
      checking = true;
      api<Run>(`/runs/${run.id}`).then(current => {
        if (live() && !isActiveRun(current.status)) finish(current);
      }).catch(e => {
        if (!live()) return;
        if (e instanceof RequestError && (e.status === 404 || e.status === 403)) forget(run.conversationId);
        setError(errorText(e));
      }).finally(() => { checking = false; });
    };
    source.addEventListener('run', event => {
      if (!live()) { source.close(); return; }
      let data: RunEvent;
      try { data = JSON.parse((event as MessageEvent<string>).data) as RunEvent; } catch { setError('事件格式错误，请刷新页面'); return; }
      if (data.id <= cursor || data.runId !== run.id) return;
      cursor = data.id;
      if (data.type === 'message.updated' || data.type === 'text.delta' || data.type === 'reasoning.delta' || data.type === 'generation.updated') {
        let message: Message;
        if (data.type === 'message.updated') message = data.message;
        else {
          const previous = replay.get(data.messageId);
          message = {
            ...previous, id: data.messageId, role: 'assistant',
            text: (previous?.text ?? '') + (data.type === 'text.delta' ? data.delta : ''),
            reasoning: (previous?.reasoning ?? '') + (data.type === 'reasoning.delta' ? data.delta : ''),
            generation: data.generation ?? previous?.generation,
            files: previous?.files ?? [], runId: run.id, createdAt: previous?.createdAt ?? data.createdAt,
          };
        }
        message.toolCalls = mergeMessage(replay.get(message.id), message).toolCalls;
        replay.set(message.id, message);
        setConversations(prev => prev.map(c => {
          if (c.id !== run.conversationId) return c;
          const existing = c.messages.find(m => m.id === message.id);
          // Reconstruct replay from zero instead of appending it to the snapshot.
          // The terminal authoritative refresh also handles shorter corrections.
          const merged = mergeMessage(existing, message);
          return { ...c, messages: existing ? c.messages.map(m => m.id === message.id ? merged : m) : [...c.messages, merged] };
        }));
      } else if (data.type === 'run.status') {
        updateRun(data.run);
        if (!isActiveRun(data.run.status)) finish(data.run);
      } else if (data.type === 'tool.status') {
        const previousMessages = [...replay.values()];
        const owner = data.messageId ?? previousMessages.find(message => message.toolCalls?.some(call => call.id === data.toolCallId))?.id ?? previousMessages[previousMessages.length - 1]?.id;
        if (!owner) return;
        const previous = replay.get(owner);
        const message: Message = mergeMessage(previous, {
          id: owner, role: 'assistant', text: previous?.text ?? '', files: previous?.files ?? [], runId: run.id, createdAt: previous?.createdAt ?? data.createdAt,
          toolCalls: [{ id: data.toolCallId, name: data.name, status: data.status, text: data.text, input: data.input, durationMs: data.durationMs, updatedAt: data.createdAt }],
        });
        replay.set(owner, message);
        setConversations(prev => prev.map(c => {
          if (c.id !== run.conversationId) return c;
          const existing = c.messages.find(item => item.id === owner);
          const merged = mergeMessage(existing, message);
          return { ...c, messages: existing ? c.messages.map(item => item.id === owner ? merged : item) : [...c.messages, merged] };
        }));
      } else if (data.type === 'error') setError(data.message);
      else if (data.type === 'file.created') window.dispatchEvent(new CustomEvent('pixel:files', { detail: run.conversationId }));
    });
  }, [refresh, updateRun, forget]);
  useEffect(() => {
    mounted.current = true;
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    let polling = false;
    Promise.all([api<ListResponse<Conversation>>('/conversations'), api<ListResponse<ModelOption>>('/models')]).then(async ([result, options]) => {
      if (cancelled) return;
      const items = result.items;
      if (!items.length) {
        const tasks = await api<ListResponse<EvaluationTask>>('/tasks');
        if (cancelled) return;
        items.push(await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ taskId: tasks.items[0]?.id }) }));
      }
      if (cancelled) return;
      setConversations(items); setModels(options.items);
      for (const c of items) if (c.activeRun || c.lastRun) updateRun((c.activeRun || c.lastRun)!);
    }).catch(e => { if (!cancelled) setError(errorText(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    const poll = setInterval(() => {
      if (cancelled || polling) return;
      const background = [...latestRuns.current.values()].filter(run => isActiveRun(run.status) && !streams.current.has(run.id));
      polling = true;
      void Promise.all(background.map(async run => {
        try {
          const current = await api<Run>(`/runs/${run.id}`);
          if (cancelled || removed.current.has(run.conversationId) || latestRuns.current.get(run.conversationId)?.id !== run.id) return;
          updateRun(current);
          // Background drawings must expose partial text/tools as well as status.
          // Keep the one-SSE budget for the visible run and refresh the others.
          await refresh(run.conversationId);
          if (!cancelled && latestRuns.current.get(run.conversationId)?.id === run.id && !streams.current.has(run.id)) {
            setConnections(prev => ({ ...prev, [run.conversationId]: isActiveRun(current.status) ? '后台更新（每 3 秒）' : '' }));
          }
        } catch (e) {
          if (cancelled || removed.current.has(run.conversationId)) return;
          if (e instanceof RequestError && (e.status === 404 || e.status === 403)) forget(run.conversationId);
          else if (!streams.current.has(run.id)) setConnections(prev => ({ ...prev, [run.conversationId]: '后台更新失败，正在重试…' }));
          setError(errorText(e));
        }
      })).finally(() => { polling = false; });
    }, 3000);
    return () => { cancelled = true; mounted.current = false; clearInterval(poll); streams.current.forEach(entry => entry.source.close()); streams.current.clear(); };
  }, [refresh, updateRun, forget, enabled]);
  return { conversations, setConversations, models, loading, error, setError, runs, connections, upsert, refresh, attach, forget };
}
