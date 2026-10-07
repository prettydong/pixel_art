import { localizeMessage, getLanguage, t } from './i18n';
import { useEffect, useState } from 'react';
import type { ListResponse, ModelOption, UsageResponse, User } from '@pixel/contracts';
import { api, errorText } from './api';

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
      <label>{t("新密码（至少 12 字符）")}<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
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
      <label>{t("初始密码")}<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
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
    }}><label>{t("重置") + " "}{selected.username} {" " + t("的密码")}<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <div className="panel-actions"><button className="action-button" disabled={busy}>{t("保存新密码")}</button><button type="button" className="action-button" onClick={() => setSelected(null)}>{t("取消")}</button></div>
    </form>}
    {error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}{notice && <p role="status">{localizeMessage(notice)}</p>}
  </section>;
}
const count = (value: number | null) => value === null ? t("未知") : value.toLocaleString(getLanguage());
const time = (value: number) => new Date(value).toLocaleString(getLanguage());
export function UsagePanel({ user, models }: { user: User; models: ModelOption[] }) {
  const [global, setGlobal] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [filters, setFilters] = useState({ from: '', to: '', modelId: '', userId: '' });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UsageResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (user.role === 'admin') void api<ListResponse<User>>('/admin/users').then(result => setUsers(result.items)).catch(err => setError(errorText(err))); }, [user.role]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    const params = new URLSearchParams({ offset: String(offset), limit: '50' });
    if (filters.from) params.set('from', String(new Date(filters.from).getTime()));
    if (filters.to) params.set('to', String(new Date(filters.to).getTime()));
    if (filters.modelId) params.set('modelId', filters.modelId);
    if (global && filters.userId) params.set('userId', filters.userId);
    api<UsageResponse>(`${global ? '/admin' : ''}/usage?${params}`).then(data => { if (alive) setResult(data); }).catch(err => { if (alive) { setError(errorText(err)); setResult(null); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [global, filters, offset, revision]);
  const change = (key: keyof typeof filters, value: string) => { setOffset(0); setFilters(prev => ({ ...prev, [key]: value })); };
  return <section className="account-panel usage-panel">
    {user.role === 'admin' && <div className="panel-actions"><button className="action-button" aria-pressed={!global} onClick={() => { setGlobal(false); setOffset(0); }}>{t("我的用量")}</button><button className="action-button" aria-pressed={global} onClick={() => { setGlobal(true); setOffset(0); }}>{t("全局用量")}</button></div>}
    <div className="usage-filters account-form">
      <label>{t("开始时间")}<input type="datetime-local" value={filters.from} onChange={e => change('from', e.target.value)} /></label>
      <label>{t("结束时间")}<input type="datetime-local" value={filters.to} onChange={e => change('to', e.target.value)} /></label>
      <label>{t("模型标识")}<input list="usage-models" value={filters.modelId} placeholder={t("全部模型")} onChange={e => change('modelId', e.target.value)} /><datalist id="usage-models">{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist></label>
      {global && <label>{t("用户")}<select value={filters.userId} onChange={e => change('userId', e.target.value)}><option value="">{t("全部用户")}</option>{users.map(item => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label>}
    </div>
    <button className="action-button" onClick={() => setRevision(value => value + 1)} disabled={loading}>{t("刷新用量")}</button>
    {loading && <p role="status">{t("读取用量…")}</p>}{error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}
    {result && <><div className="usage-summary">
      <span>{t("运行") + " "}{count(result.summary.runs)}</span><span>{t("模型输入") + " "}{count(result.summary.inputTokens)}</span><span>{t("模型输出") + " "}{count(result.summary.outputTokens)}</span>
      <span>{t("缓存读") + " "}{count(result.summary.cacheReadTokens)}</span><span>{t("缓存写") + " "}{count(result.summary.cacheWriteTokens)}</span><span>{t("工具调用") + " "}{count(result.summary.toolCalls)}</span>
      <span>{t("已知估算费用 $")}{result.summary.estimatedCost.toFixed(6)}</span><span>{t("含未知字段记录") + " "}{count(result.summary.unknownRecords)}</span>
    </div><p className="muted-text">{t("统计仅累加已知值；费用按管理员确认的单价估算，单位为美元，并非实际扣费。未确认价格或缺少用量时显示未知。")}</p>
      <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>{t("时间 / 用户")}</th><th>{t("模型 / 来源")}</th><th>{t("类型 / 状态")}</th><th>{t("Token 输入 / 输出")}</th><th>{t("缓存 读 / 写")}</th><th>{t("估算费用 / 耗时")}</th></tr></thead><tbody>{result.records.map(record => <tr key={record.id}>
        <td>{time(record.createdAt)}<small>{record.username}</small></td>
        <td>{record.modelId}<small>{t("实际调用：")}{record.actualProvider ?? t("未知提供方")} / {record.actualModel ?? t("未知模型")}</small><details><summary>{t("标识")}</summary><p>{t("来源：")}{record.sourceId}</p><p>{t("会话：")}{record.conversationId}</p><p>{t("运行：")}{record.runId}</p></details></td>
        <td>{record.kind} / {record.status}<small>{t("粒度：")}{record.granularity}</small></td>
        <td>{count(record.inputTokens)} / {count(record.outputTokens)}</td><td>{count(record.cacheReadTokens)} / {count(record.cacheWriteTokens)}</td>
        <td>{record.cost === null ? t("未知") : `$${record.cost.toFixed(6)}`}<small>{record.durationMs === null ? t("耗时未知") : `${record.durationMs} ms`}</small><small>{record.costBasis}</small></td>
      </tr>)}</tbody></table>{!result.records.length && <p>{t("所选范围内没有用量记录")}</p>}</div>
      <div className="panel-actions"><button className="action-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{t("上一页")}</button><span>{result.total ? offset + 1 : 0}–{Math.min(offset + 50, result.total)} / {result.total}</span><button className="action-button" disabled={loading || offset + 50 >= result.total} onClick={() => setOffset(value => value + 50)}>{t("下一页")}</button></div>
    </>}
  </section>;
}
