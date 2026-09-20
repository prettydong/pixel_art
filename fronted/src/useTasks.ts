import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationTask, ListResponse } from '@pixel/contracts';
import type { Conversation } from './chatTypes';
import { api, errorText } from './api';

export function useTasks(enabled: boolean, conversations: Conversation[]) {
  const [tasks, setTasks] = useState<EvaluationTask[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++sequence.current;
    try {
      const result = await api<ListResponse<EvaluationTask>>('/tasks');
      if (request !== sequence.current) return;
      setTasks(result.items); setError(''); setRevision(value => value + 1);
    } catch (err) { if (request === sequence.current) setError(errorText(err)); }
  }, [enabled]);
  const signature = conversations.map(c => `${c.id}:${c.taskId}:${c.updated}:${c.activeRun?.status}:${c.lastRun?.status}`).join('|');
  useEffect(() => { void refresh(); }, [refresh, signature]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFiles = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150); };
    window.addEventListener('pixel:files', onFiles);
    return () => { clearTimeout(timer); window.removeEventListener('pixel:files', onFiles); sequence.current++; };
  }, [refresh]);
  return { tasks, error, revision, refresh };
}
