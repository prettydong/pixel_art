import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { modes, isActiveRun, type Mode, type User, type FileRecord, type Run, type CreateRunInput, type ListResponse } from "@pixel/contracts";
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
import { useWorkspace } from "./useWorkspace";
import { useTheme } from "./theme";
import { EvaluationDiagram } from "./EvaluationDiagram";
import { PixelTransition } from "./PixelTransition";
import type { ShatterRequest } from "./pixelShatter";
import {
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
  Square,
  Trash2,
  X,
} from "./PixelIcons";

const evaluationPanels = [
  {
    mode: "数据分析" as const,
    kind: "data" as const,
    icon: BarChart,
    input: "失效地址、测试条件",
    outcome: "定位失效分布与聚集特征",
    action: "开始数据分析",
    prompt: "请协助我分析内存失效数据。\n数据来源与字段：\n失效地址与分布：\n希望评估的指标：",
  },
  {
    mode: "产品架构设置" as const,
    kind: "architecture" as const,
    icon: Chip,
    input: "阵列规模、冗余行列",
    outcome: "明确资源共享与容量约束",
    action: "设置产品架构",
    prompt: "请协助我梳理内存冗余架构。\n产品与阵列组织：\n冗余行、列资源：\n资源共享范围与约束：",
  },
  {
    mode: "修补规则设计" as const,
    kind: "repair" as const,
    icon: Repair,
    input: "失效分布、架构约束",
    outcome: "定义分配顺序与失败判据",
    action: "设计修补规则",
    prompt: "请协助我设计内存修补规则。\n适用的产品架构：\n修补优先级与分配策略：\n资源冲突与不可修补条件：",
  },
];
const emptyConversation: Conversation = { id: "", title: "新的评估对话", mode: "数据分析", messages: [], updated: 0, activeRun: null, lastRun: null };
const statusLabel: Record<string, string> = { starting: "启动中", running: "运行中", cancelling: "停止中", completed: "已完成", cancelled: "已停止", interrupted: "服务重启，运行已中断", failed: "运行失败" };
export default function App() {
  if (new URLSearchParams(window.location.search).get("demo") === "charts") return <ChartDemo />;
  if (new URLSearchParams(window.location.search).get("demo") === "tools") {
    return <Workspace demoMode user={{ id: "local-demo", username: "本地工具演示", role: "user", enabled: true, createdAt: 0 }} />;
  }
  return <AuthGate>{user => <Workspace user={user} />}</AuthGate>;
}

function Workspace({ user, demoMode = false }: { user: User; demoMode?: boolean }) {

  const [theme, setTheme] = useTheme();
  const server = useWorkspace(!demoMode);
  const demo = useDemoWorkspace(demoMode);
  const { models, loading, error, setError, runs, connections, refresh, attach, forget, upsert } = server;
  const conversations: Conversation[] = demoMode ? demo.conversations : server.conversations;
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [conversationFiles, setConversationFiles] = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const pendingRequests = useRef(new Map<string, CreateRunInput>());
  const [accountTab, setAccountTab] = useState<"settings" | "account" | "usage" | "users">("settings");
  const [searchResults, setSearchResults] = useState<Conversation[]>([]);
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const drafts = useRef(new Map<string, { text: string; files: FileRecord[] }>());
  const [modeOpen, setModeOpen] = useState(false);
  const [modePending, setModePending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState("");
  const [dialog, setDialog] = useState<"search" | "settings" | null>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(() => document.documentElement.dataset.layout === "compact");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("pixel-sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const [enteredId, setEnteredId] = useState<string | null>(null);
  const [transition, setTransition] = useState<(ShatterRequest & {
    panel: (typeof evaluationPanels)[number];
  }) | null>(null);
  const transitioning = useRef(false);
  const cardViewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [toast, setToast] = useState("");
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
    conversations.find((c) => c.id === activeId) || conversations[0] || emptyConversation;
  const currentRun = runs[active.id] || active.activeRun || active.lastRun;
  const busy = demoMode ? demo.busyIds.has(active.id) : !!currentRun && isActiveRun(currentRun.status);
  const visibleMessages: ReplyMessage[] = demoMode ? active.messages : groupReplyMessages(active.messages).filter(message =>
    message.role !== 'assistant' || message.text || message.toolCalls?.length || message.files.length || (busy && message.runId === currentRun?.id));
  if (!demoMode && busy && currentRun && !visibleMessages.some(message => message.role === 'assistant' && message.runId === currentRun.id)) {
    visibleMessages.push({ id: `${currentRun.id}:reply`, runId: currentRun.id, role: 'assistant', text: '', files: [], createdAt: currentRun.createdAt });
  }
  const submitting = pending.has(active.id);
  const showCards = !active.messages.length && enteredId !== active.id;
  const sidebarVisible = compact ? mobileOpen : !sidebarCollapsed;
  const activeIdRef = useRef(active.id);
  activeIdRef.current = active.id;
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
    if (!transition && enteredId === active.id) inputRef.current?.focus({ preventScroll: true });
  }, [transition, enteredId, active.id]);
  useEffect(() => { if (!demoMode && currentRun && isActiveRun(currentRun.status)) attach(currentRun); }, [active.id, currentRun?.id, attach, demoMode]);
  useEffect(() => { if (!model && models.length) setModel(models[0].id); }, [models, model]);
  useEffect(() => { if (error) setToast(error); }, [error]);
  useEffect(() => {
    if (!active.id || demoMode) return;
    let alive = true;
    const load = () => api<ListResponse<FileRecord>>(`/conversations/${active.id}/files`).then(result => { if (alive) setConversationFiles(result.items); }).catch(err => { if (alive) setToast(errorText(err)); });
    setConversationFiles([]);
    void load();
    const onFiles = (event: Event) => { if ((event as CustomEvent<string>).detail === active.id) void load(); };
    window.addEventListener('pixel:files', onFiles);
    return () => { alive = false; window.removeEventListener('pixel:files', onFiles); };
  }, [active.id, currentRun?.status, demoMode]);
  useEffect(() => {
    if (dialog !== 'search') return;
    if (demoMode) {
      setSearchResults(conversations.filter(c => `${c.title}\n${c.messages.map(messageMarkdown).join('\n')}`.toLowerCase().includes(query.toLowerCase())));
      setSearching(false); return;
    }
    let alive = true; setSearching(true);
    const timer = setTimeout(() => {
      api<ListResponse<Conversation>>(`/conversations?q=${encodeURIComponent(query)}`).then(result => { if (alive) setSearchResults(result.items); }).catch(err => { if (alive) setToast(errorText(err)); }).finally(() => { if (alive) setSearching(false); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, dialog, demoMode, demo.conversations]);
  useLayoutEffect(() => { followMessages.current = true; }, [active.id]);
  useEffect(() => {
    const element = messagesRef.current;
    if (element && followMessages.current) element.scrollTop = element.scrollHeight;
  }, [active.id, active.messages, busy]);
  useEffect(() => {
    if (demoMode && demo.storageError) setToast(demo.storageError);
  }, [demoMode, demo.storageError]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
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
    const keydown = (e: KeyboardEvent) => {
      if (transitioning.current || e.isComposing) return;
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

  function toggleSidebar() {
    if (compact) setMobileOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  }

  function rememberDraft() { if (active.id) drafts.current.set(active.id, { text: draft, files }); }
  async function createChat() {
    if (uploading || loading) return;
    if (demoMode) {
      rememberDraft(); const next = demo.create();
      setActiveId(next.id); setEnteredId(null);
      const saved = drafts.current.get(next.id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
      setMobileOpen(false); return;
    }
    try {
      rememberDraft();
      const empty = conversations.find(c => !c.messages.length && !c.activeRun && !pending.has(c.id));
      const next = empty || await api<Conversation>('/conversations', { method: 'POST', body: '{}' });
      upsert(next); setActiveId(next.id); setEnteredId(null);
      const saved = drafts.current.get(next.id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
      setMobileOpen(false); inputRef.current?.focus();
    } catch (err) { setToast(errorText(err)); }
  }
  async function updateMode(mode: Mode) {
    setModeOpen(false);
    if (!active.id || modePending) return;
    if (demoMode) { demo.update(active.id, { mode }); return; }
    setModePending(true);
    try { upsert(await api<Conversation>(`/conversations/${active.id}`, { method: 'PATCH', body: JSON.stringify({ mode }) })); }
    catch (err) { setToast(errorText(err)); } finally { setModePending(false); }
  }
  function selectChat(id: string) {
    if (uploading) { setToast('请等待附件上传完成'); return; }
    rememberDraft();
    setEnteredId(id); setActiveId(id);
    const saved = drafts.current.get(id); setDraft(saved?.text || ''); setFiles(saved?.files || []);
    setDialog(null); setMobileOpen(false); setRenaming(false);
    // A server search may return a conversation created in another tab.
    if (!demoMode) void refresh(id).then(c => { if (c.activeRun || c.lastRun) attach((c.activeRun || c.lastRun)!); }).catch(err => setToast(errorText(err)));
  }
  async function stopReply() {
    if (demoMode) { demo.stop(active.id); return; }
    if (!currentRun || currentRun.status === 'cancelling') return;
    try { await api<Run>(`/runs/${currentRun.id}/cancel`, { method: 'POST', body: '{}' }); }
    catch (err) { setToast(errorText(err)); }
  }
  async function deleteChat(id: string) {
    if (demoMode) {
      const next = demo.remove(id); drafts.current.delete(id);
      if (active.id === id) { setActiveId(next.id); setDraft(''); setFiles([]); setEnteredId(null); }
      setToast('本地演示对话已删除'); return;
    }
    try {
      await api(`/conversations/${id}`, { method: 'DELETE' });
      drafts.current.delete(id); pendingRequests.current.delete(id);
      forget(id);
      if (activeIdRef.current === id) { setActiveId(''); setDraft(''); setFiles([]); setEnteredId(null); }
      if (conversations.length === 1) upsert(await api<Conversation>('/conversations', { method: 'POST', body: '{}' }));
      setToast('对话已删除');
    } catch (err) { setToast(errorText(err)); }
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
      await refresh(id).catch(err => setToast(errorText(err)));
      attach(run);
      pendingRequests.current.delete(id); drafts.current.delete(id);
      if (activeIdRef.current === id) { setDraft(''); setFiles([]); setEnteredId(id); }
    } catch (err) {
      if (err instanceof RequestError && err.status < 500) pendingRequests.current.delete(id);
      if (err instanceof RequestError && err.status === 409) void refresh(id).then(c => { if (c.activeRun || c.lastRun) attach((c.activeRun || c.lastRun)!); }).catch(() => {});
      setToast(errorText(err));
      // Retain an uncertain submission's key so retry cannot execute it twice.
    } finally { setPending(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }
  async function upload(selected: File[]) {
    if (!active.id || uploading) return;
    if (files.length + selected.length > 20) { setToast('每次提交最多附带 20 个文件'); return; }
    if (demoMode) {
      setFiles(prev => [...prev, ...selected.map(file => ({ id: requestId(), conversationId: active.id, name: file.name, size: file.size, kind: 'upload' as const, createdAt: Date.now() }))]);
      setToast('演示附件仅记录名称，未上传或解析内容'); return;
    }
    setUploading(true);
    try {
      for (const file of selected) {
        const form = new FormData(); form.append('file', file);
        const uploaded = await api<FileRecord>('/uploads', { method: 'POST', body: form });
        setFiles(prev => [...prev, uploaded]); setConversationFiles(prev => [...prev, uploaded]);
      }
    } catch (err) { setToast(errorText(err)); } finally { setUploading(false); }
  }
  function prompt(mode: Mode, value: string) {
    updateMode(mode);
    const hasCustomDraft = draft.trim() && !evaluationPanels.some((panel) => panel.prompt === draft);
    if (hasCustomDraft) setToast(`已切换至${mode}，保留现有草稿`);
    else setDraft(value);
    setEnteredId(active.id);
  }
  function confirmPanel(panel: (typeof evaluationPanels)[number], selectedIndex: number, origin: ShatterRequest["origin"]) {
    if (transitioning.current || !active.id) return;
    setModeOpen(false);
    setModelOpen(false);
    if (!motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prompt(panel.mode, panel.prompt);
      return;
    }
    transitioning.current = true;
    setTransition({ panel, selectedIndex, origin });
  }
  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(messageMarkdown(message));
      setCopied(message.id);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setToast("无法访问剪贴板，请手动选择文字复制");
    }
  }
  function exportChat() {
    const blob = new Blob(
      [
        `# ${active.title}\n\n${active.messages.map((m) => `## ${m.role === "user" ? "你" : demoMode ? "Pixel（演示）" : "Pixel"}\n\n${messageMarkdown(m)}${m.files?.length ? `\n\n附件名称：${m.files.map(file => file.name).join("、")}` : ""}`).join("\n\n")}`,
      ],
      { type: "text/markdown;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pixel-chat.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("对话已导出");
  }

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          aria-label="关闭侧边栏"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside id="chat-sidebar" className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} inert={!!transition}>
        <div className="sidebar-header">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              createChat();
            }}
          >
            <span className="brand-icon">
              <MessageSquare />
            </span>
            <span>
              PIXEL<span className="brand-light">CHAT</span>
            </span>
          </a>
          <button className="icon-button" aria-label="收起侧边栏" title="收起侧边栏（Ctrl / Cmd + B）" onClick={() => {
            toggleSidebar();
            sidebarToggleRef.current?.focus();
          }}>
            <PanelLeftClose />
          </button>
        </div>
        <button className="new-chat" onClick={createChat}>
          <Plus />
          <span>新建评估</span>
        </button>
        <button className="search-trigger" onClick={() => setDialog("search")}>
          <Search />
          <span>搜索对话</span>
        </button>
        <div className="history-heading">
          <span>最近对话</span>
          <button
            className="icon-button"
            aria-label="搜索全部对话"
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
<span>{c.title}{(c.activeRun || (runs[c.id] && isActiveRun(runs[c.id].status))) ? " · 运行中" : ""}</span>
                </button>
                <button
                  className="delete-chat"
                  disabled={pending.has(c.id) || (uploading && c.id === active.id)}
                  aria-label={`删除对话：${c.title}`}
                  onClick={() => deleteChat(c.id)}
                >
                  <Trash2 />
                </button>
              </div>
            ))
          ) : (
            <p className="history-empty">暂无对话</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="profile" onClick={() => setDialog("settings")}>
            <span>设置</span>
            <Settings2 />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar" inert={!!transition}>
          <div className="breadcrumbs">
            <button
              ref={sidebarToggleRef}
              className="icon-button"
              aria-label={sidebarVisible ? "收起侧边栏" : "展开侧边栏"}
              title="切换侧边栏（Ctrl / Cmd + B）"
              aria-controls="chat-sidebar"
              aria-expanded={sidebarVisible}
              aria-keyshortcuts="Control+b Meta+b"
              onClick={toggleSidebar}
            >
              {sidebarVisible ? <PanelLeftClose /> : <Menu />}
            </button>
            <button className="current-title" title="重命名对话" onClick={() => { setRenameTitle(active.title); setRenaming(true); }}>{active.messages.length ? active.title : showCards ? "内存冗余架构评估" : active.mode}</button>
          </div>
          <div className="topbar-right">
            {!showCards && !active.messages.length && (
              <button className="return-directions" onClick={() => setEnteredId(null)}>选择方向</button>
            )}
            <button
              className="icon-button"
              aria-label="导出当前对话"
              title="导出当前对话"
              onClick={exportChat}
            >
              <Download />
            </button>
            <button
              className="icon-button"
              aria-label="工作台设置"
              onClick={() => setDialog("settings")}
            >
              <Settings2 />
            </button>
          </div>
        </header>
        <div
          className={`workspace ${active.messages.length ? "has-messages" : ""}`}
          aria-busy={!!transition}
        >
          <div className="workspace-content" inert={!!transition}>
            {renaming && <form className="rename-form account-form" onSubmit={async e => {
              e.preventDefault();
              if (demoMode) { demo.update(active.id, { title: renameTitle.trim() }); setRenaming(false); return; }
              try { upsert(await api<Conversation>(`/conversations/${active.id}`, { method: 'PATCH', body: JSON.stringify({ title: renameTitle.trim() }) })); setRenaming(false); } catch (err) { setToast(errorText(err)); }
            }}><input aria-label="对话标题" value={renameTitle} onChange={e => setRenameTitle(e.target.value)} autoFocus required maxLength={120} /><button className="action-button" disabled={!renameTitle.trim()}>保存</button><button type="button" className="action-button" onClick={() => setRenaming(false)}>取消</button></form>}
            {error && <div className="workspace-error" role="alert">{error}<button onClick={() => window.location.reload()}>重新连接</button><button onClick={() => setError('')}>关闭</button></div>}
            {loading && <p role="status">正在读取会话…</p>}

            {showCards ? (
              <div ref={cardViewportRef} className="card-stage">
                <section className="welcome" aria-label="内存冗余架构评估工作台">
                  <div className="evaluation-panels">
                    {evaluationPanels.map((panel, index) => (
                      <section
                        key={panel.mode}
                        className={`evaluation-slot evaluation-${panel.kind}`}
                        aria-labelledby={`panel-${index}`}
                      >
                        <div className="evaluation-card-motion" ref={(node) => { cardRefs.current[index] = node; }}>
                          <div className={`evaluation-panel ${active.mode === panel.mode ? "selected" : ""}`}>
                            <div className="evaluation-card-top">
                              <panel.icon />
                              <h1 className="evaluation-heading" id={`panel-${index}`}>{panel.mode}</h1>
                              <span className="evaluation-indicator" aria-hidden="true">
                                {active.mode === panel.mode ? <Check /> : <ArrowRight />}
                              </span>
                            </div>
                            <figure className="evaluation-figure">
                              <EvaluationDiagram kind={panel.kind} />
                            </figure>
                            <dl className="evaluation-details">
                              <div><dt>输入</dt><dd>{panel.input}</dd></div>
                              <div><dt>目标</dt><dd>{panel.outcome}</dd></div>
                            </dl>
                          </div>
                        </div>
                        <button
                          className="evaluation-hit-area"
                          aria-label={panel.action}
                          aria-pressed={active.mode === panel.mode}
                          onClick={(event) => confirmPanel(panel, index,
                            event.detail === 0 ? null : { x: event.clientX, y: event.clientY })}
                        />
                      </section>
                    ))}
                  </div>
                </section>
                {motion && (
                  <PixelTransition
                    key={active.id}
                    cards={cardRefs}
                    viewport={cardViewportRef}
                    request={transition}
                    onComplete={() => {
                      if (!transition) return;
                      prompt(transition.panel.mode, transition.panel.prompt);
                      transitioning.current = false;
                      setTransition(null);
                    }}
                  />
                )}
              </div>
            ) : (
              <section
                className="messages"
                ref={messagesRef}
                onScroll={event => {
                  const element = event.currentTarget;
                  const grid = parseFloat(getComputedStyle(document.documentElement).fontSize);
                  followMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 16 * grid;
                }}
                aria-label="对话消息"
                aria-busy={busy}
              >
                {visibleMessages.map((m) => (
                  <article key={m.id} className={`message ${m.role}`}>
                    <div className="message-body">
                      <div className="message-author">
                        {m.role === "assistant" ? demoMode ? "Pixel（本地演示）" : "Pixel" : "你"}
                      </div>
                      <div className="message-content">
                        {!demoMode && m.role === "assistant" ? <StreamingReply message={m} pending={busy && m.runId === currentRun?.id} /> : m.text ? (m.role === "assistant" ? <MarkdownMessage text={m.text} /> : <UserMessageText text={m.text} />) :
                          ((m.delivery === "streaming" || (!demoMode && busy && m.runId === currentRun?.id)) ? (
                            <span className="typing-dots">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : (
                            m.delivery === "stopped" ? "回复已停止。" : null
                          ))}
                        {m.delivery === "stopped" && m.text && <p className="message-delivery-status">回复已停止，以上内容可能不完整。</p>}
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
                          {demoMode && <small>仅记录文件名，未上传或解析内容</small>}
                        </div>
                      ) : null}
                      {m.role === "assistant" && Boolean(m.text || m.tools?.length) && (
                        <button className="copy-message" onClick={() => copy(m)}>
                          {copied === m.id ? (
                            <Check />
                          ) : (
                            <Copy />
                          )}
                          {copied === m.id ? "已复制" : "复制"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            )}

            <div className="run-context">
              {demoMode && <div className="run-status" role="status">{busy ? '本地演示回复中 · 可停止' : '本地工具演示 · 仅保存在当前浏览器，未连接模型'}</div>}
              {demoMode && demo.storageError && <div className="workspace-error" role="alert">{demo.storageError}</div>}
              {(currentRun || submitting || uploading) && <div className="run-status" role="status">{uploading ? '附件上传中' : submitting ? '正在提交…' : `${statusLabel[currentRun!.status]}${busy && connections[active.id] ? ` · ${connections[active.id]}` : ''}`}{currentRun?.error && <span className="error-text">{currentRun.error}</span>}</div>}
              {!!conversationFiles.filter(file => file.kind === 'upload').length && <details className="file-details">
                <summary>共享上传（{conversationFiles.filter(file => file.kind === 'upload').length}）</summary>
                <div className="message-files">{conversationFiles.filter(file => file.kind === 'upload').map(file => <span key={file.id} className="shared-upload">
                  <a href={fileUrl(file)} download><Paperclip />{file.name}</a>
                  <button type="button" disabled={busy || submitting || uploading || files.some(f => f.id === file.id)}
                    aria-label={`添加 ${file.name} 到本次分析`}
                    onClick={() => { if (files.length >= 20) { setToast('每次提交最多附带 20 个文件'); return; } setFiles(prev => prev.some(f => f.id === file.id) ? prev : [...prev, file]); }}>
                    {files.some(f => f.id === file.id) ? '已添加' : '添加到本次分析'}
                  </button>
                </span>)}</div>
              </details>}
              {!!conversationFiles.filter(file => file.kind === 'artifact').length && <details className="file-details">
                <summary>本会话产物（{conversationFiles.filter(file => file.kind === 'artifact').length}）</summary>
                <div className="message-files">{conversationFiles.filter(file => file.kind === 'artifact').map(file => <a key={file.id} href={fileUrl(file)} download><Paperclip />{file.name}</a>)}</div>
              </details>}

            </div>
            <div className="composer-area">
              <div className="composer">
                <textarea
                  ref={inputRef}
                  value={draft}
                  disabled={submitting}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`补充${active.mode}的目标、已知条件或问题…`}
                  aria-label="输入消息"
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
                          aria-label={`移除附件 ${f.name}`}
                          onClick={() =>
                            setFiles((prev) => prev.filter((v) => v.id !== f.id))
                          }
                        >
                          <X />
                        </button>
                      </span>
                    ))}
                    <small>{demoMode ? '仅记录文件名，未上传或解析内容' : '上传文件在你的会话间共享，本次仅提交已选附件'}</small>
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
                      aria-label={demoMode ? "添加演示附件" : "上传附件"}
                      title={demoMode ? "添加演示附件（仅记录文件名）" : "上传附件"} disabled={uploading || submitting || !active.id}
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
                        {active.mode}
                        <ChevronDown />
                      </button>
                      {modeOpen && (
                        <div className="dropdown mode-dropdown">
                          {modes.map((m) => (
                            <button key={m} onClick={() => updateMode(m)}>
                              {m}
                              {active.mode === m && <Check />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="dropdown-anchor">
                      <button
                        className="model-trigger"
                        title="选择模型"
                        aria-expanded={modelOpen}
                        onClick={() => {
                          setModelOpen(!modelOpen);
                          setModeOpen(false);
                        }}
                      >
                        {demoMode ? "本地工具演示" : models.find(item => item.id === model)?.label || "尚未配置模型"}
                        <ChevronDown />
                      </button>
                      {modelOpen && (
                        <div className="dropdown model-dropdown">
                          <small>可用模型</small>
                          {demoMode ? <a className="demo-mode-link" href={window.location.pathname}>返回服务端工作台</a> : <a className="demo-mode-link" href="?demo=tools" target="_blank" rel="noopener noreferrer">打开本地工具演示</a>}
                          <a className="demo-mode-link" href="?demo=charts" target="_blank" rel="noopener noreferrer">查看像素图表演示</a>
                          {models.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setModel(m.id);
                                setModelOpen(false);
                              }}
                            >
                              {m.label}
                              {model === m.id && <Check />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="send-tools">
                    <button
                      className={`send-button ${busy ? "is-busy" : ""}`}
                      aria-label={busy ? "停止回复" : "发送消息"}
                      disabled={busy ? currentRun?.status === "cancelling" : (!draft.trim() || submitting || uploading || modePending || (!demoMode && !model) || !active.id)}
                      onClick={busy ? stopReply : send}
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
            <h2>{dialog === "search" ? "搜索评估对话" : "工作台设置"}</h2>
            <button
              className="icon-button"
              aria-label="关闭弹窗"
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
                  placeholder="搜索对话标题或内容…"
                  aria-label="搜索对话"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="search-results">{searching && <p role="status">搜索中…</p>}
                {searchResults.map((c) => (
                    <button key={c.id} onClick={() => selectChat(c.id)}>
                      <MessageSquare />
                      <span>
                        {c.title}
                        <small>
                          {c.mode} · {c.messages.length} 条消息
                        </small>
                      </span>
                      <ArrowRight />
                    </button>
                  ))}
                {!searching && !searchResults.length && (
                  <div className="search-empty">
                    <Folder />
                    <p>
                      {query
                        ? "没有找到相关对话"
                        : "还没有对话，先聊点什么吧。"}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="panel-actions account-tabs" role="group" aria-label="设置页面">
                {([['settings', '外观'], ...(!demoMode ? [['account', '账号'], ['usage', '用量']] : []), ...(user.role === 'admin' ? [['users', '用户管理']] : [])] as [typeof accountTab, string][]).map(([tab, label]) => <button key={tab} className="action-button" aria-pressed={accountTab === tab} onClick={() => setAccountTab(tab)}>{label}</button>)}
              </div>
              {accountTab === 'account' && <AccountPanel user={user} />}
              {accountTab === 'users' && user.role === 'admin' && <UsersPanel user={user} />}
              {accountTab === 'usage' && <UsagePanel user={user} models={models} />}
              {accountTab === 'settings' && <>
              <div className="setting-row theme-row">
                <span>外观</span>
                <div className="theme-options" role="group" aria-label="外观模式">
                  {([
                    { value: "system", label: "跟随系统" },
                    { value: "light", label: "亮色" },
                    { value: "dark", label: "暗色" },
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
                  界面动效<small>文字高光、卡片跳跃与像素粉碎</small>
                </div>
                <button
                  role="switch"
                  aria-checked={motion}
                  aria-label="界面动效"
                  className={`toggle ${motion ? "on" : ""}`}
                  onClick={() => setMotion(!motion)}
                >
                  <span />
                </button>
              </div>
              <button className="export-button" onClick={exportChat}>
                <Download />
                导出当前对话为 Markdown
              </button>
              <div className="settings-note">
                Ctrl / Cmd + K 搜索对话
                <br />Ctrl / Cmd + B 收起 / 展开侧栏
              </div></>}
            </>
          )}
        </div>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check />
          {toast}
        </div>
      )}
    </div>
  );
}
