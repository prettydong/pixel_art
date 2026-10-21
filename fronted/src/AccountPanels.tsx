import { localizeMessage, getLanguage, t } from './i18n';
import { useEffect, useState } from 'react';
import { DEFAULT_PASSWORD, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, type ListResponse, type ModelOption, type UsageRecord, type UsageResponse, type User } from '@pixel/contracts';
import { api, errorText } from './api';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from './Icons';

export function AccountPanel({ user }: { user: User }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="account-panel"><p>{user.username} · {user.role === 'admin' ? t("管理员") : t("用户")}</p>
    <form className="account-form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
      try {
        await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), password: data.get('password') }) });
        window.dispatchEvent(new Event('pixel:unauthorized'));
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}><label>{t("当前密码")}<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} /></label>
      <label>{t("新密码")}<input type="password" name="password" autoComplete="new-password" defaultValue={DEFAULT_PASSWORD} required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} /></label>
      <button className="action-button" disabled={busy}>{t("修改密码并重新登录")}</button>
    </form>
    <button className="action-button" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { await api('/auth/logout', { method: 'POST', body: '{}' }); window.dispatchEvent(new Event('pixel:unauthorized')); }
      catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>{t("退出登录")}</button>
    {error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}
  </section>;
}

export function UsersPanel({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const load = async () => setUsers((await api<ListResponse<User>>('/admin/users')).items);
  useEffect(() => { void load().catch(err => setError(errorText(err))); }, []);
  return <section className="account-panel"><h3>{t("创建账号")}</h3>
    <form className="account-form" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); setBusy(true); setError(''); setNotice('');
      try {
        await api('/admin/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }) });
        form.reset(); await load(); setNotice(t("账号已创建"));
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>
      <label>{t("用户名")}<input name="username" required maxLength={64} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" /></label>
      <label>{t("初始密码")}<input name="password" type="password" defaultValue={DEFAULT_PASSWORD} required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" /></label>
      <label>{t("角色")}<select name="role"><option value="user">{t("用户")}</option><option value="admin">{t("管理员")}</option></select></label>
      <button className="action-button" disabled={busy}>{t("创建账号")}</button>
    </form>
    <h3>{t("账号列表")}</h3><div className="user-list">{users.map(item => <div className="user-row" key={item.id}>
      <span>{item.username}{item.id === user.id ? t("（当前账号）") : ''}<small>{item.role === 'admin' ? t("管理员") : t("用户")} · {item.enabled ? t("已启用") : t("已停用")}</small></span>
      <button className="action-button" disabled={busy} onClick={() => { setSelected(item); setNotice(''); }}>{t("重置密码")}</button>
      <button className="action-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setNotice('');
        try { await api(`/admin/users/${item.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled }) }); await load(); }
        catch (err) { setError(errorText(err)); } finally { setBusy(false); }
      }}>{item.enabled ? t("停用") : t("启用")}</button>
    </div>)}</div>
    {selected && <form className="account-form" key={selected.id} onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
      try { await api(`/admin/users/${selected.id}/password`, { method: 'POST', body: JSON.stringify({ password: data.get('password') }) }); setNotice(t("{0} 的密码已重置", selected.username)); setSelected(null); }
      catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}><label>{t("重置") + " "}{selected.username} {" " + t("的密码")}<input name="password" type="password" defaultValue={DEFAULT_PASSWORD} required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" /></label>
      <div className="panel-actions"><button className="action-button" disabled={busy}>{t("保存新密码")}</button><button type="button" className="action-button" onClick={() => setSelected(null)}>{t("取消")}</button></div>
    </form>}
    {error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}{notice && <p role="status">{localizeMessage(notice)}</p>}
  </section>;
}
const count = (value: number | null) => value === null ? t("未知") : value.toLocaleString(getLanguage());
const compact = (value: number) => value.toLocaleString(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 });
const money = (value: number | null) => value === null ? t("未知") : value === 0 ? '$0' : value < 0.01 ? `$${value.toPrecision(2)}` : `$${value.toFixed(2)}`;
const time = (value: number) => new Date(value).toLocaleString(getLanguage());
const shortTime = (value: number) => new Date(value).toLocaleString(getLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const duration = (ms: number | null) => ms === null ? t("耗时未知") : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const PAGE = 50;
const ranges = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
type Range = keyof typeof ranges | 'all' | 'custom';
const rangeLabels: Record<Range, () => string> = { day: () => t("24 小时"), week: () => t("7 天"), month: () => t("30 天"), all: () => t("全部时间"), custom: () => t("自定义") };

export function UsagePanel({ user, models }: { user: User; models: ModelOption[] }) {
  const [global, setGlobal] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [range, setRange] = useState<Range>('all');
  const [filters, setFilters] = useState({ from: '', to: '', modelId: '', userId: '' });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UsageResponse | null>(null);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (user.role === 'admin') void api<ListResponse<User>>('/admin/users').then(result => setUsers(result.items)).catch(err => setError(errorText(err))); }, [user.role]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (range === 'custom') {
      if (filters.from) params.set('from', String(new Date(filters.from).getTime()));
      if (filters.to) params.set('to', String(new Date(filters.to).getTime()));
    } else if (range !== 'all') params.set('from', String(Date.now() - ranges[range]));
    if (filters.modelId) params.set('modelId', filters.modelId);
    if (global && filters.userId) params.set('userId', filters.userId);
    api<UsageResponse>(`${global ? '/admin' : ''}/usage?${params}`).then(data => {
      if (!alive) return;
      setResult(data);
      setModelIds(previous => [...new Set([...previous, ...data.records.map(record => record.modelId)])]);
    }).catch(err => { if (alive) { setError(errorText(err)); setResult(null); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [global, range, filters, offset, revision]);
  const change = (key: keyof typeof filters, value: string) => { setOffset(0); setFilters(prev => ({ ...prev, [key]: value })); };
  const modelOptions = [...models.map(model => ({ id: model.id, label: model.label })), ...modelIds.filter(id => !models.some(model => model.id === id)).map(id => ({ id, label: id }))];
  const summary = result?.summary;
  return <section className="account-panel usage-panel" aria-busy={loading}>
    <div className="usage-toolbar">
      {user.role === 'admin' && <div className="segmented" role="group" aria-label={t("用量")}><button aria-pressed={!global} onClick={() => { setGlobal(false); setOffset(0); }}>{t("我的用量")}</button><button aria-pressed={global} onClick={() => { setGlobal(true); setOffset(0); }}>{t("全局用量")}</button></div>}
      <div className="segmented" role="group" aria-label={t("时间范围")}>{(Object.keys(rangeLabels) as Range[]).map(key => <button key={key} aria-pressed={range === key} onClick={() => { setRange(key); setOffset(0); }}>{rangeLabels[key]()}</button>)}</div>
      <button className="icon-button usage-refresh" aria-label={t("刷新用量")} title={t("刷新用量")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw /></button>
    </div>
    <div className="usage-filters">
      {range === 'custom' && <><label>{t("开始时间")}<input type="datetime-local" value={filters.from} onChange={e => change('from', e.target.value)} /></label>
      <label>{t("结束时间")}<input type="datetime-local" value={filters.to} onChange={e => change('to', e.target.value)} /></label></>}
      <label>{t("模型")}<select value={filters.modelId} onChange={e => change('modelId', e.target.value)}><option value="">{t("全部模型")}</option>{modelOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      {global && <label>{t("用户")}<select value={filters.userId} onChange={e => change('userId', e.target.value)}><option value="">{t("全部用户")}</option>{users.map(item => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label>}
    </div>
    {error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}
    {summary && <>
      <div className="usage-summary">
        <div title={count(summary.runs)}><span>{t("运行")}</span><strong>{compact(summary.runs)}</strong></div>
        <div title={count(summary.inputTokens)}><span>{t("输入 token")}</span><strong>{compact(summary.inputTokens)}</strong></div>
        <div title={count(summary.outputTokens)}><span>{t("输出 token")}</span><strong>{compact(summary.outputTokens)}</strong></div>
        <div title={`$${summary.estimatedCost.toFixed(6)}`}><span>{t("估算费用")}</span><strong>{money(summary.estimatedCost)}</strong></div>
      </div>
      <p className="usage-secondary">
        <span>{t("缓存 读 / 写")} {compact(summary.cacheReadTokens)} / {compact(summary.cacheWriteTokens)}</span>
        <span>{t("工具调用")} {count(summary.toolCalls)}</span>
        {!!summary.unknownRecords && <span className="usage-warn">{t("含未知字段记录")} {count(summary.unknownRecords)}</span>}
        <span title={t("统计仅累加已知值；费用按管理员确认的单价估算，单位为美元，并非实际扣费。未确认价格或缺少用量时显示未知。")}>{t("费用为估算，非实际扣费")}</span>
      </p>
    </>}
    {result && <>
      <div className="sheet-frame usage-sheet"><table className="sheet" key={String(global)}>
        <thead><tr><th scope="col" style={{ width: 132 }}>{t("时间")}</th><th scope="col">{t("模型")}</th>{global && <th scope="col" className="sheet-optional" style={{ width: 96 }}>{t("用户")}</th>}<th scope="col" className="sheet-optional" style={{ width: 120 }}>{t("类型 / 状态")}</th><th scope="col" style={{ width: 88 }}>{t("输入")}</th><th scope="col" style={{ width: 88 }}>{t("输出")}</th><th scope="col" style={{ width: 84 }}>{t("费用")}</th></tr></thead>
        <tbody>{result.records.map(record => <UsageRow key={record.id} record={record} global={global} />)}
          {!result.records.length && <tr className="sheet-empty"><td colSpan={global ? 7 : 6}>{loading ? t("读取用量…") : t("所选范围内没有用量记录")}</td></tr>}</tbody>
      </table></div>
      {result.total > PAGE && <div className="usage-pager"><button className="icon-button" aria-label={t("上一页")} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE))}><ChevronLeft /></button><span>{offset + 1}–{Math.min(offset + PAGE, result.total)} / {result.total.toLocaleString(getLanguage())}</span><button className="icon-button" aria-label={t("下一页")} disabled={loading || offset + PAGE >= result.total} onClick={() => setOffset(value => value + PAGE)}><ChevronRight /></button></div>}
    </>}
    {!result && loading && <p role="status" className="muted-text">{t("读取用量…")}</p>}
  </section>;
}

function UsageRow({ record, global }: { record: UsageRecord; global: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = /error|fail|retry/i.test(record.status);
  return <>
    <tr className={`sheet-row ${open ? 'is-open' : ''}`} onClick={() => setOpen(value => !value)}>
      <th scope="row"><button className="sheet-toggle" aria-expanded={open} title={time(record.createdAt)} onClick={event => { event.stopPropagation(); setOpen(value => !value); }}>{open ? <ChevronDown /> : <ChevronRight />}<span>{shortTime(record.createdAt)}</span></button></th>
      <td title={record.modelId}>{record.modelId}</td>
      {global && <td className="sheet-optional" title={record.username}>{record.username}</td>}
      <td className="sheet-optional sheet-muted">{record.kind}{failed && <span className="usage-warn"> · {record.status}</span>}</td>
      <td>{record.inputTokens === null ? '–' : record.inputTokens.toLocaleString(getLanguage())}</td>
      <td>{record.outputTokens === null ? '–' : record.outputTokens.toLocaleString(getLanguage())}</td>
      <td title={record.cost === null ? t("未知") : `$${record.cost.toFixed(6)}`}>{record.cost === null ? '–' : money(record.cost)}</td>
    </tr>
    {open && <tr className="sheet-detail"><td colSpan={global ? 7 : 6}><div><dl className="usage-detail">
      <dt>{t("时间")}</dt><dd>{time(record.createdAt)}</dd>
      <dt>{t("用户")}</dt><dd>{record.username}</dd>
      <dt>{t("实际调用")}</dt><dd>{record.actualProvider ?? t("未知提供方")} / {record.actualModel ?? t("未知模型")}</dd>
      <dt>{t("类型 / 状态")}</dt><dd>{record.kind} / {record.status} · {t("粒度：")}{record.granularity}</dd>
      <dt>{t("缓存 读 / 写")}</dt><dd>{count(record.cacheReadTokens)} / {count(record.cacheWriteTokens)}</dd>
      <dt>{t("费用")}</dt><dd>{record.cost === null ? t("未知") : `$${record.cost.toFixed(6)}`} · {record.costBasis}</dd>
      <dt>{t("耗时")}</dt><dd>{duration(record.durationMs)}</dd>
      <dt>{t("标识")}</dt><dd className="usage-ids">{t("来源：")}{record.sourceId}<br />{t("会话：")}{record.conversationId}<br />{t("运行：")}{record.runId}</dd>
    </dl></div></td></tr>}
  </>;
}
