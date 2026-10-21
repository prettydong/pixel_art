import { localizeMessage, t, useLanguage } from './i18n';
import { LanguageSelect } from './LanguageSelect';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { modes, isActiveRun, type Mode, type User, type FileRecord, type Run, type CreateRunInput, type ListResponse, type EvaluationTask, type TaskArchitecture, type DemoTask } from "@pixel/contracts";
import { saveRepairDraft } from './repairDraft';
import type { Message, Conversation } from "./chatTypes";
import { messageMarkdown } from "./chatTools";
import { useDemoWorkspace } from "./useDemoWorkspace";
import { InteractiveTools } from "./InteractiveTools";
import { MarkdownMessage } from "./MarkdownMessage";
import { UserMessageText } from "./UserMessageText";
import { StreamingReply } from "./StreamingReply";
import { ChartDemo } from "./ChartDemo";
import { groupReplyMessages, type ReplyMessage } from "./replyMessages";
import { api, errorText, fileUrl, RequestError, requestId } from "./api";
import { AuthGate } from "./AuthGate";
import { AccountPanel, UsersPanel, UsagePanel } from "./AccountPanels";
import { RunBadge, TaskNavigation, taskViewLabels, type TaskView } from "./TaskNavigation";
import { DeleteChatButton } from "./DeleteChatButton";
import { TaskPanel } from "./TaskPanel";
import { findArchitectureDrawing } from "./ArchitectureDrawingProgress";
import { useTasks } from "./useTasks";
import { useWorkspace } from "./useWorkspace";
import { useTheme } from "./theme";
import { useAutoConclusions } from './solverPreferences';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { Thinking } from "./Thinking";
import { sparkBurst, sparkBurstFrom } from "./fun";
import { EvaluationDiagram } from './EvaluationDiagram';
import {
  Alert,
  ArrowRight,
  ArrowUp,
  BarChart,
  Chip,
  Repair,
  Check,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  Folder,
  Menu,
  MessageSquare,
  Paperclip,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Spark,
  Square,
  X,
} from "./Icons";

const evaluationPanels = [
  {
    mode: "数据分析" as const,
    kind: "data" as const,
    icon: BarChart,
    get input() { return t("失效地址、测试条件"); },
    get outcome() { return t("定位失效分布与聚集特征"); },
    get action() { return t("开始数据分析"); },
    get prompt() { return t("请协助我分析内存失效数据。\n数据来源与字段：\n失效地址与分布：\n希望评估的指标："); },
  },
  {
    mode: "产品架构设置" as const,
    kind: "architecture" as const,
    icon: Chip,
    get input() { return t("Region 尺寸、Segment 划分、CCR 资源"); },
    get outcome() { return t("配置 Region 全局备用 row 与 Segment CCR col"); },
    get action() { return t("设置产品架构"); },
    get prompt() { return t("请协助我配置 CCR 内存冗余架构。\n产品与 Region row / col 尺寸：\nRegion 共享的全局备用 row 数（默认 128）：\nSegment 的 section/subsection row 地址映射：\n每个 Segment 的 CCR 子组数与每组备用 col 容量：\n全局备用 row 由 Region 内所有 Segment 共享，不跨 Region 借用；col 按零基地址取模分组，CCR 备用 col 不跨 Segment、Region 或子组借用。"); },
  },
  {
    mode: "修补规则设计" as const,
    kind: "repair" as const,
    icon: Repair,
    get input() { return t("失效分布、架构约束"); },
    get outcome() { return t("定义分配顺序与失败判据"); },
    get action() { return t("设计修补规则"); },
    get prompt() { return t("请协助我设计 CCR 内存修补规则。\n适用的产品架构：\nRegion 全局备用 row 容量（默认 128）与 Segment 内 CCR 备用 col 容量：\n修补优先级与分配策略：\n资源冲突与不可修补条件：\nrow 修复使用 Region 共享的全局备用 row，替换一条原始 row 并覆盖其所有 col；col 修复仅覆盖本 Segment 内对应的原始 col 地址。row 资源不跨 Region 共享，CCR col 资源不跨 Segment、Region 或子组共享。"); },
  },
];
const emptyConversation: Conversation = { id: "", get title() { return t("新的评估对话"); }, mode: "数据分析", messages: [], updated: 0, activeRun: null, lastRun: null };
const statusLabel: Record<string, string> = { get starting() { return t("启动中"); }, get running() { return t("运行中"); }, get cancelling() { return t("停止中"); }, get completed() { return t("已完成"); }, get cancelled() { return t("已停止"); }, get interrupted() { return t("服务重启，运行已中断"); }, get failed() { return t("运行失败"); } };
export default function App() {
  useLanguage();
  if (new URLSearchParams(window.location.search).get("demo") === "charts") return <ChartDemo />;
  if (new URLSearchParams(window.location.search).get("demo") === "tools") {
    return <Workspace demoMode user={{ id: "local-demo", username: t("本地工具演示"), role: "user", enabled: true, createdAt: 0 }} />;
  }
  return <AuthGate>{user => <Workspace user={user} />}</AuthGate>;
}

function Workspace({ user, demoMode = false }: { user: User; demoMode?: boolean }) {

  const [theme, setTheme] = useTheme();
  const [autoConclusions, setAutoConclusions] = useAutoConclusions();
  const server = useWorkspace(!demoMode);
  const demo = useDemoWorkspace(demoMode);
  const { models, loading, error, setError, runs, connections, refresh, attach, forget, upsert } = server;
  const conversations: Conversation[] = demoMode ? demo.conversations : server.conversations;
  const taskState = useTasks(!demoMode, conversations);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskView, setTaskView] = useState<TaskView>('chat');
  const [moveTaskId, setMoveTaskId] = useState('');
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const pendingRequests = useRef(new Map<string, CreateRunInput>());
  const demoRequestKey = useRef<string | null>(null);
  const [accountTab, setAccountTab] = useState<"settings" | "account" | "usage" | "users">("settings");
  const [searchResults, setSearchResults] = useState<Conversation[]>([]);
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const drafts = useRef(new Map<string, { text: string; files: FileRecord[] }>());
  const [modeOpen, setModeOpen] = useState(false);
  const [modePending, setModePending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModelState] = useState(() => {
    try { return localStorage.getItem("pixel-chat-model") ?? ""; }
    catch { return ""; }
  });
  const [dialog, setDialog] = useState<"search" | "settings" | null>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(() => document.documentElement.dataset.layout === "compact");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("pixel-sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const [enteredId, setEnteredId] = useState<string | null>(null);
  const [toast, setToastState] = useState<{ text: string; error: boolean } | null>(null);
  const setToast = (text: string) => setToastState(text ? { text, error: false } : null);
  const showError = (text: string) => setToastState(text ? { text, error: true } : null);
  const [copied, setCopied] = useState("");
  const [motion, setMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const followMessages = useRef(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active =
    conversations.find((c) => c.id === activeId) || conversations.find(c => c.taskId === selectedTaskId) || conversations[0] || emptyConversation;
  const activeTaskId = selectedTaskId || active.taskId || taskState.tasks[0]?.id || '';
  const activeTask = taskState.tasks.find(task => task.id === activeTaskId);
  const currentRun = runs[active.id] || active.activeRun || active.lastRun;
  const drawingRun = taskView === 'architecture' ? findArchitectureDrawing(conversations.filter(chat => chat.taskId === activeTaskId))?.run : undefined;
  const visibleRun = taskView === 'architecture' ? drawingRun : taskView === 'chat' ? currentRun : undefined;
  const busy = demoMode ? demo.busyIds.has(active.id) : !!currentRun && isActiveRun(currentRun.status);
  const visibleMessages: ReplyMessage[] = demoMode ? active.messages : groupReplyMessages(active.messages).filter(message =>
    message.role !== 'assistant' || message.text || message.toolCalls?.length || message.files.length || (busy && message.runId === currentRun?.id));
  if (!demoMode && busy && currentRun && !visibleMessages.some(message => message.role === 'assistant' && message.runId === currentRun.id)) {
    visibleMessages.push({ id: `${currentRun.id}:reply`, runId: currentRun.id, role: 'assistant', text: '', files: [], createdAt: currentRun.createdAt });
  }
  const submitting = pending.has(active.id);
  // Without a conversation (still loading, or no task exists) there is nothing to type into.
  const noConversation = !demoMode && !active.id;
  const showCards = !noConversation && !active.messages.length && enteredId !== active.id;
  // An entered, empty conversation gives the remaining height to the draft.
  const fillComposer = !showCards && !visibleMessages.length;
  const sidebarVisible = compact ? mobileOpen : !sidebarCollapsed;
  const activeIdRef = useRef(active.id);
  activeIdRef.current = active.id;
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  const history = [...conversations]
    .sort((a, b) => b.updated - a.updated);
  useLayoutEffect(() => {
    document.documentElement.dataset.sidebar = sidebarCollapsed ? "collapsed" : "expanded";
    try { localStorage.setItem("pixel-sidebar-collapsed", String(sidebarCollapsed)); }
    catch { /* The current session still supports collapsing the sidebar. */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = document.documentElement.dataset.layout === "compact";
      setCompact(next);
      if (!next) setMobileOpen(false);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-layout"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (enteredId === active.id) inputRef.current?.focus({ preventScroll: true });
  }, [enteredId, active.id]);
  useEffect(() => { if (!demoMode && visibleRun && isActiveRun(visibleRun.status)) attach(visibleRun); }, [taskView, activeTaskId, visibleRun?.id, visibleRun?.status, attach, demoMode]);
  // A remembered model that the administrator removed falls back to the first available one.
  useEffect(() => { if (!loading && !models.some(item => item.id === model)) setModelState(models[0]?.id ?? ""); }, [models, model, loading]);
  useEffect(() => {
    if (dialog !== 'search') return;
    if (demoMode) {
      setSearchResults(conversations.filter(c => `${c.title}\n${c.messages.map(messageMarkdown).join('\n')}`.toLowerCase().includes(query.toLowerCase())));
      setSearching(false); return;
    }
    let alive = true; setSearching(true);
    const timer = setTimeout(() => {
      api<ListResponse<Conversation>>(`/conversations?q=${encodeURIComponent(query)}`).then(result => { if (alive) setSearchResults(result.items); }).catch(err => { if (alive) showError(errorText(err)); }).finally(() => { if (alive) setSearching(false); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, dialog, demoMode, demo.conversations]);
  useLayoutEffect(() => { followMessages.current = true; }, [active.id, taskView]);
  useEffect(() => {
    const element = messagesRef.current;
    if (element && followMessages.current) element.scrollTop = element.scrollHeight;
  }, [active.id, active.messages, busy, taskView]);
  useEffect(() => {
    if (demoMode && demo.storageError) showError(demo.storageError);
  }, [demoMode, demo.storageError]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToastState(null), toast.error ? 7000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
  }, [motion]);
  useEffect(() => {
    document.documentElement.dataset.busy = String(busy || submitting);
  }, [busy, submitting]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (!e.repeat) toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog("search");
      }
      if (e.key === "Escape") {
        setDialog(null);
        setModeOpen(false);
        setModelOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [compact]);

  function chooseModel(id: string) {
    setModelState(id); setModelOpen(false);
    try { localStorage.setItem("pixel-chat-model", id); } catch { /* The selection still applies to this session. */ }
  }
  function toggleSidebar() {
    if (compact) setMobileOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  }

  function rememberDraft() { if (active.id) drafts.current.set(active.id, { text: draft, files }); }
  async function createChat(taskId = activeTaskId) {
    if (uploading || loading) return;
    if (demoMode) {
      rememberDraft(); const next = demo.create();
      setActiveId(next.id); setEnteredId(null);
      const saved = drafts.current.get(next.id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
      setMobileOpen(false); return;
    }
    try {
      rememberDraft();
      const next = await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ taskId: taskId || undefined, title: t('新的评估对话') }) });
      setSelectedTaskId(next.taskId || ''); setTaskView('chat');
      upsert(next); setActiveId(next.id); setEnteredId(null);
      const saved = drafts.current.get(next.id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
      setMobileOpen(false); inputRef.current?.focus();
    } catch (err) { showError(errorText(err)); }
  }
  async function createEvaluationTask(name: string) {
    const task = await api<EvaluationTask>('/tasks', { method: 'POST', body: JSON.stringify({ name }) });
    setSelectedTaskId(task.id); setTaskView('architecture');
    await taskState.refresh();
    await createChat(task.id);
  }
  async function loadDejoaDemo() {
    const key = demoRequestKey.current ?? requestId();
    demoRequestKey.current = key;
    try {
      const demo = await api<DemoTask>('/demos/dejoa', { method: 'POST', body: JSON.stringify({ idempotencyKey: key }) });
      saveRepairDraft(demo.task.id, { items: demo.architectures.flatMap(architecture => demo.wafers.map(wafer => ({
        architectureId: architecture.id, architectureName: architecture.name, architectureFingerprint: architecture.fingerprint,
        waferId: wafer.id, waferName: wafer.name,
      }))), submission: null });
      demoRequestKey.current = null;
      rememberDraft(); setSelectedTaskId(demo.task.id); setTaskView('repair'); setMobileOpen(false);
      await taskState.refresh();
      setToast(t('DEJOA 演示已加载，9 个组合待手动运行。'));
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) demoRequestKey.current = null;
      throw error;
    }
  }
  async function generateArchitecturePreview(architecture: TaskArchitecture) {
    if (!model || uploading || loading) return;
    const chat = await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ taskId: activeTaskId, title: t("架构预览 · {0}", architecture.name).slice(0, 120), mode: '产品架构设置' }) });
    upsert(chat);
    const text = t("请为当前任务中的架构 {0}（ID：{1}，指纹：{2}）生成 Pixi 架构预览。按架构预览 Harness README 的 Fast Path：运行 --init {1} --publish 一条命令生成并发布标准绘图，然后返回实际尺寸与产物路径。只读 README 和任务上下文；不读 Harness、contracts、前端源码或 git 历史，不写模拟测试，不修改 work 以外的文件，不执行修补求解。--init 报告非标准定义时才按 README 手写；发布因 work 以外的原因失败时直接报告错误原文。开始和结束各用一句中文说明。", architecture.name, architecture.id, architecture.fingerprint);
    try {
      const run = await api<Run>(`/conversations/${chat.id}/runs`, { method: 'POST', body: JSON.stringify({ text, mode: chat.mode, modelId: model, fileIds: [], idempotencyKey: requestId() }) });
      await refresh(chat.id); attach(run); if (run.status === 'failed') throw new Error(run.error || t("Agent 启动失败")); setToast(t("Agent 正在绘制，可在任务下的架构预览聊天中查看进度"));
    } catch (err) { await refresh(chat.id).catch(() => {}); throw err; }
  }
  async function renameEvaluationTask(id: string, name: string) {
    await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    await taskState.refresh();
  }
  async function deleteEvaluationTask(id: string) {
    const result = await api<{ ok: boolean; conversationIds: string[] }>(`/tasks/${id}`, { method: 'DELETE' });
    const deletedChats = new Set([...result.conversationIds, ...conversations.filter(chat => chat.taskId === id).map(chat => chat.id)]);
    taskState.forget(id);
    for (const chatId of deletedChats) {
      drafts.current.delete(chatId); pendingRequests.current.delete(chatId); forget(chatId);
    }
    setPending(previous => new Set([...previous].filter(chatId => !deletedChats.has(chatId))));
    setSearchResults(previous => previous.filter(chat => chat.taskId !== id && !deletedChats.has(chat.id)));
    setMoveTaskId(previous => previous === id ? '' : previous);
    if (activeTaskIdRef.current === id) {
      const nextTask = taskState.tasks.find(task => task.id !== id);
      const nextChat = conversations.find(chat => chat.taskId === nextTask?.id && !deletedChats.has(chat.id));
      setSelectedTaskId(nextTask?.id ?? ''); setTaskView('architecture'); setActiveId(nextChat?.id ?? '');
      const saved = nextChat ? drafts.current.get(nextChat.id) : undefined;
      setDraft(saved?.text ?? ''); setFiles(saved?.files ?? []); setEnteredId(null); setRenaming(false); setMobileOpen(false);
    } else if (deletedChats.has(activeIdRef.current)) {
      setActiveId(''); setDraft(''); setFiles([]); setEnteredId(null); setRenaming(false);
    }
    try { localStorage.removeItem(`pixel:collapsed-architectures:${id}`); localStorage.removeItem(`pixel:expanded-architectures:${id}`); } catch { /* Optional local view state. */ }
    await taskState.refresh();
    setToast(t("评估任务及其聊天已删除"));
  }
  function openTask(id: string, view: TaskView) {
    if (uploading) { setToast(t("请等待附件上传完成")); return; }
    setSelectedTaskId(id); setTaskView(view); setMobileOpen(false); setRenaming(false);
  }
  async function updateMode(mode: Mode) {
    setModeOpen(false);
    if (!active.id || modePending) return;
    if (demoMode) { demo.update(active.id, { mode }); return; }
    setModePending(true);
    try { upsert(await api<Conversation>(`/conversations/${active.id}`, { method: 'PATCH', body: JSON.stringify({ mode }) })); }
    catch (err) { showError(errorText(err)); } finally { setModePending(false); }
  }
  function selectChat(id: string) {
    if (uploading) { setToast(t("请等待附件上传完成")); return; }
    rememberDraft();
    setSelectedTaskId(conversations.find(c => c.id === id)?.taskId || searchResults.find(c => c.id === id)?.taskId || ''); setTaskView('chat');
    setEnteredId(id); setActiveId(id);
    const saved = drafts.current.get(id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
    setDialog(null); setMobileOpen(false); setRenaming(false);
    // A server search may return a conversation created in another tab.
    if (!demoMode) void refresh(id).then(c => { if (c.activeRun || c.lastRun) attach((c.activeRun || c.lastRun)!); }).catch(err => showError(errorText(err)));
  }
  async function stopReply() {
    if (demoMode) { demo.stop(active.id); return; }
    if (!currentRun || currentRun.status === 'cancelling') return;
    try { await api<Run>(`/runs/${currentRun.id}/cancel`, { method: 'POST', body: '{}' }); }
    catch (err) { showError(errorText(err)); }
  }
  async function deleteChat(id: string) {
    if (demoMode) {
      const next = demo.remove(id); drafts.current.delete(id);
      if (active.id === id) { setActiveId(next.id); setDraft(''); setFiles([]); setEnteredId(null); }
      setToast(t("本地演示对话已删除")); return;
    }
    try {
      await api(`/conversations/${id}`, { method: 'DELETE' });
      drafts.current.delete(id); pendingRequests.current.delete(id);
      forget(id);
      if (activeIdRef.current === id) {
        setSelectedTaskId(conversations.find(chat => chat.id === id)?.taskId || '');
        setActiveId(''); setDraft(''); setFiles([]); setEnteredId(null); setTaskView('architecture');
      }
      await taskState.refresh();
      setToast(t("对话已删除"));
    } catch (err) { showError(errorText(err)); }
  }
  async function send() {
    const text = draft.trim();
    if (demoMode) {
      if (demo.send(active.id, text, files)) {
        followMessages.current = true; drafts.current.delete(active.id);
        setDraft(''); setFiles([]); setEnteredId(active.id);
      }
      return;
    }
    if (!text || busy || submitting || uploading || modePending || !active.id || !model) return;
    followMessages.current = true;
    const id = active.id;
    const prior = pendingRequests.current.get(id);
    const same = prior && prior.text === text && prior.mode === active.mode && prior.modelId === model && JSON.stringify(prior.fileIds) === JSON.stringify(files.map(f => f.id));
    const request: CreateRunInput = same && prior ? prior : { text, mode: active.mode, modelId: model, fileIds: files.map(f => f.id), idempotencyKey: requestId() };
    pendingRequests.current.set(id, request);
    setPending(prev => new Set(prev).add(id)); setError('');
    try {
      const run = await api<Run>(`/conversations/${id}/runs`, { method: 'POST', body: JSON.stringify(request) });
      // Keep the authoritative user message and a complete snapshot before replay.
      await refresh(id).catch(err => showError(errorText(err)));
      attach(run);
      pendingRequests.current.delete(id); drafts.current.delete(id);
      if (activeIdRef.current === id) { setDraft(''); setFiles([]); setEnteredId(id); }
    } catch (err) {
      if (err instanceof RequestError && err.status < 500) pendingRequests.current.delete(id);
      if (err instanceof RequestError && err.status === 409) void refresh(id).then(c => { if (c.activeRun || c.lastRun) attach((c.activeRun || c.lastRun)!); }).catch(() => {});
      showError(errorText(err));
      // Retain an uncertain submission's key so retry cannot execute it twice.
    } finally { setPending(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }
  async function upload(selected: File[]) {
    if (!active.id || uploading) return;
    if (files.length + selected.length > 20) { showError(t("每次提交最多附带 20 个文件")); return; }
    if (demoMode) {
      setFiles(prev => [...prev, ...selected.map(file => ({ id: requestId(), conversationId: active.id, name: file.name, size: file.size, kind: 'upload' as const, createdAt: Date.now() }))]);
      setToast(t("演示附件仅记录名称，未上传或解析内容")); return;
    }
    setUploading(true);
    try {
      for (const file of selected) {
        const form = new FormData(); form.append('file', file);
        const uploaded = await api<FileRecord>(`/conversations/${active.id}/files`, { method: 'POST', body: form });
        setFiles(prev => [...prev, uploaded]);
      }
    } catch (err) { showError(errorText(err)); } finally { setUploading(false); void taskState.refresh(); }
  }
  function prompt(mode: Mode, value: string) {
    updateMode(mode);
    const hasCustomDraft = draft.trim() && !evaluationPanels.some((panel) => panel.prompt === draft);
    if (hasCustomDraft) setToast(t("已切换至{0}，保留现有草稿", t(mode)));
    else setDraft(value);
    setEnteredId(active.id);
  }
  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(messageMarkdown(message));
      setCopied(message.id);
      sparkBurstFrom(document.activeElement, 6);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      showError(t("无法访问剪贴板，请手动选择文字复制"));
    }
  }
  function exportChat() {
    const blob = new Blob(
      [
        `# ${active.title}\n\n${active.messages.map((m) => `## ${m.role === "user" ? t("你") : demoMode ? t("Pixel（演示）") : "Pixel"}\n\n${messageMarkdown(m)}${m.files?.length ? t("\n\n附件名称：{0}", m.files.map(file => file.name).join(t("、"))) : ""}`).join("\n\n")}`,
      ],
      { type: "text/markdown;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pixel-chat.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast(t("对话已导出"));
  }

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          aria-label={t("关闭侧边栏")}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside id="chat-sidebar" className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        {!compact && !sidebarCollapsed && <SidebarResizeHandle disabled={false} />}
        <div className="sidebar-content">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon" onClick={event => {
              const icon = event.currentTarget;
              icon.classList.remove("is-twirling"); void icon.offsetWidth; icon.classList.add("is-twirling");
              sparkBurstFrom(icon, 12);
            }}>
              <Spark />
            </span>
            <span>Pixel Chat</span>
          </div>
        </div>
        {!demoMode ? <>
          <button className="search-trigger" onClick={() => setDialog('search')}><Search /><span>{t("搜索任务和聊天")}</span></button>
          <TaskNavigation tasks={taskState.tasks} conversations={conversations} runs={runs} activeTaskId={activeTaskId} activeChatId={active.id} view={taskView}
            loading={loading || taskState.loading} disabled={loading || uploading || pending.size > 0}
            onView={openTask} onChat={selectChat} onCreateChat={createChat} onCreateTask={createEvaluationTask} onLoadDemo={loadDejoaDemo} onRenameTask={renameEvaluationTask} onDeleteTask={deleteEvaluationTask} onDeleteChat={deleteChat} />
          {taskState.error && <div className="workspace-error" role="alert">{localizeMessage(taskState.error)}<button onClick={() => void taskState.refresh()}>{t("重试")}</button></div>}
        </> : <>
        <button className="new-chat" onClick={() => createChat()}>
          <Plus />
          <span>{t("新建评估")}</span>
        </button>
        <button className="search-trigger" onClick={() => setDialog("search")}>
          <Search />
          <span>{t("搜索对话")}</span>
        </button>
        <div className="history-heading">
          <span>{t("最近对话")}</span>
          <button
            className="icon-button"
            aria-label={t("搜索全部对话")}
            onClick={() => setDialog("search")}
          >
            <Ellipsis />
          </button>
        </div>
        <div className="history-list">
          {history.length ? (
            history.map((c) => (
              <div
                className={`history-item ${c.id === active.id ? "selected" : ""}`}
                key={c.id}
              >
                <button onClick={() => selectChat(c.id)}>
                  <MessageSquare />
                  <span>{c.title}</span>
                  {demo.busyIds.has(c.id) && <RunBadge />}
                </button>
                <DeleteChatButton
                  title={c.title}
                  disabled={pending.has(c.id) || (uploading && c.id === active.id)}
                  onDelete={() => void deleteChat(c.id)}
                />
              </div>
            ))
          ) : (
            <p className="history-empty">{t("暂无对话")}</p>
          )}
        </div>
        </>}
        </div>
        <div className="sidebar-bottom">
          <button className="profile" onClick={() => setDialog("settings")}>
            <span>{t("设置")}</span>
            <Settings2 />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={sidebarToggleRef}
              className="icon-button"
              aria-label={sidebarVisible ? t("收起侧边栏") : t("展开侧边栏")}
              title={t("切换侧边栏（Ctrl / Cmd + B）")}
              aria-controls="chat-sidebar"
              aria-expanded={sidebarVisible}
              aria-keyshortcuts="Control+b Meta+b"
              onClick={toggleSidebar}
            >
              {sidebarVisible ? <PanelLeftClose /> : <Menu />}
            </button>
            {!demoMode && <span className="task-breadcrumb" title={activeTask?.name}>{activeTask?.name}</span>}
            {taskView === 'chat' ? (noConversation ? <span>{t("内存冗余架构评估")}</span> : <button className="current-title" title={t("重命名或移动聊天")} onClick={() => { setRenameTitle(active.title); setMoveTaskId(active.taskId || ''); setRenaming(true); }}>{active.title}</button>) : <span>{taskViewLabels[taskView]}</span>}
          </div>
          <div className="topbar-right">
            {taskView === 'chat' && !noConversation && !showCards && !active.messages.length && (
              <button className="return-directions" onClick={() => setEnteredId(null)}>{t("选择方向")}</button>
            )}
            <button
              className="icon-button"
              disabled={taskView !== 'chat' || !active.id}
              aria-label={t("导出当前对话")}
              title={t("导出当前对话")}
              onClick={exportChat}
            >
              <Download />
            </button>
            <button
              className="icon-button"
              aria-label={t("工作台设置")}
              onClick={() => setDialog("settings")}
            >
              <Settings2 />
            </button>
          </div>
        </header>
        <div className={`workspace ${active.messages.length ? "has-messages" : ""}`}>
          <div className="workspace-content">
            {taskView === 'chat' && renaming && <form className="rename-form account-form" onSubmit={async e => {
              e.preventDefault();
              if (demoMode) { demo.update(active.id, { title: renameTitle.trim() }); setRenaming(false); return; }
              try { upsert(await api<Conversation>(`/conversations/${active.id}`, { method: 'PATCH', body: JSON.stringify({ title: renameTitle.trim(), taskId: moveTaskId || undefined }) })); if (moveTaskId) setSelectedTaskId(moveTaskId); setRenaming(false); void taskState.refresh(); } catch (err) { showError(errorText(err)); }
            }}><input aria-label={t("对话标题")} value={renameTitle} onChange={e => setRenameTitle(e.target.value)} autoFocus required maxLength={120} />{!demoMode && <select aria-label={t("所属任务")} value={moveTaskId} disabled={busy || submitting} onChange={event => setMoveTaskId(event.target.value)}>{taskState.tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select>}<button className="action-button" disabled={!renameTitle.trim() || submitting}>{t("保存")}</button><button type="button" className="action-button" onClick={() => setRenaming(false)}>{t("取消")}</button></form>}
            {error && <div className="workspace-error" role="alert">{localizeMessage(error)}<button onClick={() => window.location.reload()}>{t("重新连接")}</button><button onClick={() => setError('')}>{t("关闭")}</button></div>}
            {loading && <p role="status">{t("正在读取会话…")}</p>}

            {!demoMode && taskView !== 'chat' ? (activeTaskId ? <TaskPanel key={activeTaskId} taskId={activeTaskId} view={taskView} revision={taskState.revision} conversations={conversations} connections={connections} models={models} modelId={model} onRefresh={taskState.refresh} onChat={selectChat} onRepairChat={async id => { try { await refresh(id); selectChat(id); } catch (err) { showError(errorText(err)); } }} onCreateChat={createChat} onGeneratePreview={generateArchitecturePreview} previewAvailable={!!model && !loading && !uploading} /> : <p>{t("请先新建任务。")}</p>) : noConversation ? (!loading && <p className="task-empty">{t("请先新建任务。")}</p>) : <>
            {showCards ? (
              <div className="card-stage">
                <section className="welcome" aria-label={t("内存冗余架构评估工作台")}>
                  <div className="evaluation-panels">
                    {evaluationPanels.map((panel, index) => (
                      <section
                        key={panel.mode}
                        className={`evaluation-slot evaluation-${panel.kind}`}
                        aria-labelledby={`panel-${index}`}
                      >
                        <div className="evaluation-card-motion">
                          <div className={`evaluation-panel ${active.mode === panel.mode ? "selected" : ""}`}>
                            <div className="evaluation-card-top">
                              <panel.icon />
                              <h1 className="evaluation-heading" id={`panel-${index}`}>{t(panel.mode)}</h1>
                              <span className="evaluation-indicator" aria-hidden="true">
                                {active.mode === panel.mode ? <Check /> : <ArrowRight />}
                              </span>
                            </div>
                            <figure className="evaluation-figure">
                              <EvaluationDiagram kind={panel.kind} />
                            </figure>
                            <dl className="evaluation-details">
                              <div><dt>{t("输入")}</dt><dd>{panel.input}</dd></div>
                              <div><dt>{t("目标")}</dt><dd>{panel.outcome}</dd></div>
                            </dl>
                          </div>
                        </div>
                        <button
                          className="evaluation-hit-area"
                          aria-label={panel.action}
                          aria-pressed={active.mode === panel.mode}
                          onClick={(event) => {
                            if (event.detail) sparkBurst(event.clientX, event.clientY, 7);
                            setModeOpen(false);
                            setModelOpen(false);
                            if (active.id) prompt(panel.mode, panel.prompt);
                          }}
                        />
                      </section>
                    ))}
                  </div>
                </section>
              </div>
            ) : !fillComposer && (
              <section
                className="messages"
                ref={messagesRef}
                onScroll={event => {
                  const element = event.currentTarget;
                  followMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
                }}
                aria-label={t("对话消息")}
                aria-busy={busy}
              >
                {visibleMessages.map((m) => (
                  <article key={m.id} className={`message ${m.role}`}>
                    <div className="message-body">
                      <div className="message-author">
                        {m.role === "assistant" ? demoMode ? t("Pixel（本地演示）") : "Pixel" : t("你")}
                      </div>
                      <div className="message-content">
                        {!demoMode && m.role === "assistant" ? <StreamingReply message={m} pending={busy && m.runId === currentRun?.id} /> : m.text ? (m.role === "assistant" ? <MarkdownMessage text={m.text} /> : <UserMessageText text={m.text} />) :
                          ((m.delivery === "streaming" || (!demoMode && busy && m.runId === currentRun?.id)) ? (
                            <Thinking />
                          ) : (
                            m.delivery === "stopped" ? t("回复已停止。") : null
                          ))}
                        {m.delivery === "stopped" && m.text && <p className="message-delivery-status">{t("回复已停止，以上内容可能不完整。")}</p>}
                        {m.role === "assistant" && m.tools?.length ? <InteractiveTools
                          tools={m.tools}
                          disabled={!demoMode || busy || m.delivery === "streaming"}
                          onSubmit={result => { followMessages.current = true; demo.submit(active.id, result); }}
                        /> : null}
                      </div>
                      {m.files?.length ? (
                        <div className="message-files">
                          {m.files.map((f) => (
                            demoMode ? <span key={f.id}><Paperclip />{f.name}</span> : <a key={f.id} href={fileUrl(f)} download><Paperclip />{f.name}</a>
                          ))}
                          {demoMode && <small>{t("演示：附件未上传")}</small>}
                        </div>
                      ) : null}
                      {m.role === "assistant" && Boolean(m.text || m.tools?.length) && (
                        <button className="copy-message" onClick={() => copy(m)}>
                          {copied === m.id ? (
                            <Check />
                          ) : (
                            <Copy />
                          )}
                          {copied === m.id ? t("已复制") : t("复制")}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            )}

            <div className="run-context">
              {demoMode && <div className="run-status" role="status">{busy ? t("本地演示回复中 · 可停止") : t("本地工具演示 · 仅保存在当前浏览器，未连接模型")}</div>}
              {demoMode && demo.storageError && <div className="workspace-error" role="alert">{localizeMessage(demo.storageError)}</div>}
              {(currentRun || submitting || uploading) && <div className="run-status" role="status">{uploading ? t("附件上传中") : submitting ? t("正在提交…") : `${statusLabel[currentRun!.status]}${busy && connections[active.id] ? ` · ${localizeMessage(connections[active.id])}` : ''}`}{currentRun?.error && <span className="error-text">{localizeMessage(currentRun.error)}</span>}</div>}

            </div>
            <div className={`composer-area ${fillComposer ? "fill" : ""}`}>
              <div className="composer">
                <textarea
                  ref={inputRef}
                  value={draft}
                  disabled={submitting}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("补充{0}的目标、已知条件或问题…", t(active.mode))}
                  aria-label={t("输入消息")}
                  rows={2}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                {files.length > 0 && (
                  <div className="attachments">
                    {files.map((f) => (
                      <span key={f.id}>
                        <Paperclip />
                        {f.name}
                        <button
                          disabled={submitting}
                          aria-label={t("移除附件 {0}", f.name)}
                          onClick={() =>
                            setFiles((prev) => prev.filter((v) => v.id !== f.id))
                          }
                        >
                          <X />
                        </button>
                      </span>
                    ))}
                    {demoMode && <small>{t("演示：附件未上传")}</small>}
                  </div>
                )}
                <div className="composer-bottom">
                  <div className="composer-tools">
                    <input
                      type="file"
                      ref={uploadRef}
                      hidden
                      multiple
                      onChange={(e) => { void upload(Array.from(e.target.files || [])); e.target.value = ""; }}
                    />
                    <button
                      className="icon-button"
                      aria-label={demoMode ? t("添加演示附件") : t("上传附件")}
                      title={demoMode ? t("添加演示附件（仅记录文件名）") : t("上传附件")} disabled={uploading || submitting || !active.id}
                      onClick={() => uploadRef.current?.click()}
                    >
                      <Paperclip />
                    </button>
                    <div className="dropdown-anchor">
                      <button
                        className="mode-trigger"
                        disabled={modePending || !active.id}
                        aria-expanded={modeOpen}
                        onClick={() => {
                          setModeOpen(!modeOpen);
                          setModelOpen(false);
                        }}
                      >
                        {t(active.mode)}
                        <ChevronDown />
                      </button>
                      {modeOpen && (
                        <div className="dropdown mode-dropdown">
                          {modes.map((m) => (
                            <button key={m} onClick={() => updateMode(m)}>
                              {t(m)}
                              {active.mode === m && <Check />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="dropdown-anchor">
                      <button
                        className="model-trigger"
                        title={t("选择模型")}
                        aria-expanded={modelOpen}
                        onClick={() => {
                          setModelOpen(!modelOpen);
                          setModeOpen(false);
                        }}
                      >
                        {demoMode ? t("本地工具演示") : models.find(item => item.id === model)?.label || (loading ? t("正在读取模型…") : t("尚未配置模型"))}
                        <ChevronDown />
                      </button>
                      {modelOpen && (
                        <div className="dropdown model-dropdown">
                          <small>{t("可用模型")}</small>
                          {models.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => chooseModel(m.id)}
                            >
                              {m.label}
                              {model === m.id && <Check />}
                            </button>
                          ))}
                          <div className="dropdown-separator" />
                          {demoMode ? <a className="demo-mode-link" href={window.location.pathname}>{t("返回服务端工作台")}</a> : <a className="demo-mode-link" href="?demo=tools" target="_blank" rel="noopener noreferrer">{t("打开本地工具演示")}</a>}
                          <a className="demo-mode-link" href="?demo=charts" target="_blank" rel="noopener noreferrer">{t("查看图表演示")}</a>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="send-tools">
                    <button
                      className={`send-button ${busy ? "is-busy" : ""}`}
                      aria-label={busy ? t("停止回复") : t("发送消息")}
                      disabled={busy ? currentRun?.status === "cancelling" : (!draft.trim() || submitting || uploading || modePending || (!demoMode && !model) || !active.id)}
                      onClick={event => {
                        if (busy) { void stopReply(); return; }
                        sparkBurstFrom(event.currentTarget);
                        void send();
                      }}
                    >
                      {busy ? (
                        <Square fill="currentColor" />
                      ) : (
                        <ArrowUp />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </>}
          </div>
        </div>
      </main>
      <dialog
        ref={dialogRef}
        className={`modal ${dialog === "settings" && accountTab === "usage" ? "wide-modal" : ""}`}
        onCancel={() => setDialog(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDialog(null);
        }}
      >
        <div className="modal-inner">
          <div className="modal-heading">
            <h2>{dialog === "search" ? t("搜索评估对话") : t("工作台设置")}</h2>
            <button
              className="icon-button"
              aria-label={t("关闭弹窗")}
              onClick={() => setDialog(null)}
            >
              <X />
            </button>
          </div>
          {dialog === "search" ? (
            <>
              <div className="search-field">
                <Search />
                <input
                  autoFocus
                  placeholder={t("搜索任务名、聊天标题或内容…")}
                  aria-label={t("搜索对话")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && !searching && searchResults[0]) selectChat(searchResults[0].id);
                  }}
                />
              </div>
              <div className="search-results">{searching && <p role="status">{t("搜索中…")}</p>}
                {searchResults.map((c) => (
                    <button key={c.id} onClick={() => selectChat(c.id)}>
                      <MessageSquare />
                      <span>
                        {c.title}
                        <small>
                          {taskState.tasks.find(task => task.id === c.taskId)?.name || t(c.mode)} · {c.messages.length} {" " + t("条消息")}</small>
                      </span>
                      <ArrowRight />
                    </button>
                  ))}
                {!searching && !searchResults.length && (
                  <div className="search-empty">
                    <Folder />
                    <p>
                      {query
                        ? t("没有找到相关对话")
                        : t("还没有对话，先聊点什么吧。")}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="panel-actions account-tabs" role="group" aria-label={t("设置页面")}>
                {([['settings', t("常规")], ...(!demoMode ? [['account', t("账号")], ['usage', t("用量")]] : []), ...(user.role === 'admin' ? [['users', t("用户管理")]] : [])] as [typeof accountTab, string][]).map(([tab, label]) => <button key={tab} className="action-button" aria-pressed={accountTab === tab} onClick={() => setAccountTab(tab)}>{label}</button>)}
              </div>
              {accountTab === 'account' && <AccountPanel user={user} />}
              {accountTab === 'users' && user.role === 'admin' && <UsersPanel user={user} />}
              {accountTab === 'usage' && <UsagePanel user={user} models={models} />}
              {accountTab === 'settings' && <>
              <div className="setting-row"><LanguageSelect /></div>
              <div className="setting-row">
                <div>{t("自动生成结论")}<small className="task-note"> · {t("用于之后启动的 Solver")}</small></div>
                <button role="switch" aria-checked={autoConclusions} aria-label={t("自动生成结论")}
                  className={`toggle ${autoConclusions ? 'on' : ''}`} onClick={() => setAutoConclusions(!autoConclusions)}><span /></button>
              </div>
              <div className="setting-row theme-row">
                <span>{t("外观")}</span>
                <div className="theme-options" role="group" aria-label={t("外观模式")}>
                  {([
                    { value: "system", label: t("跟随系统") },
                    { value: "light", label: t("亮色") },
                    { value: "dark", label: t("暗色") },
                  ] as const).map(({ value, label }) => (
                    <button
                      key={value}
                      aria-pressed={theme === value}
                      onClick={() => setTheme(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  {t("界面动效")}</div>
                <button
                  role="switch"
                  aria-checked={motion}
                  aria-label={t("界面动效")}
                  className={`toggle ${motion ? "on" : ""}`}
                  onClick={() => setMotion(!motion)}
                >
                  <span />
                </button>
              </div>
              <button className="export-button" onClick={exportChat}>
                <Download />
                {t("导出当前对话为 Markdown")}</button>
              <div className="settings-note">
                {t("Ctrl / Cmd + K 搜索对话")}<br />{t("Ctrl / Cmd + B 收起 / 展开侧栏")}</div></>}
            </>
          )}
        </div>
      </dialog>
      {toast && (
        <div className={`toast ${toast.error ? "toast-error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.error ? <Alert /> : <Check />}
          <span>{localizeMessage(toast.text)}</span>
          <button className="icon-button" aria-label={t("关闭通知")} onClick={() => setToastState(null)}>
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
