import { useEffect, useState } from 'react';
import type { ListResponse, ModelOption, UsageResponse, User } from '@pixel/contracts';
import { api, errorText } from './api';

export function AccountPanel({ user }: { user: User }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="account-panel"><p>{user.username} · {user.role === 'admin' ? '管理员' : '用户'}</p>
    <form className="account-form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
      try {
        await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), password: data.get('password') }) });
        window.dispatchEvent(new Event('pixel:unauthorized'));
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}><label>当前密码<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} /></label>
      <label>新密码（至少 12 字符）<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <button className="action-button" disabled={busy}>修改密码并重新登录</button>
    </form>
    <button className="action-button" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { await api('/auth/logout', { method: 'POST', body: '{}' }); window.dispatchEvent(new Event('pixel:unauthorized')); }
      catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>退出登录</button>
    {error && <p role="alert" className="error-text">{error}</p>}
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
  return <section className="account-panel"><h3>创建账号</h3>
    <form className="account-form" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); setBusy(true); setError(''); setNotice('');
      try {
        await api('/admin/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }) });
        form.reset(); await load(); setNotice('账号已创建');
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>
      <label>用户名<input name="username" required maxLength={64} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" /></label>
      <label>初始密码<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <label>角色<select name="role"><option value="user">用户</option><option value="admin">管理员</option></select></label>
      <button className="action-button" disabled={busy}>创建账号</button>
    </form>
    <h3>账号列表</h3><div className="user-list">{users.map(item => <div className="user-row" key={item.id}>
      <span>{item.username}{item.id === user.id ? '（当前账号）' : ''}<small>{item.role === 'admin' ? '管理员' : '用户'} · {item.enabled ? '已启用' : '已停用'}</small></span>
      <button className="action-button" disabled={busy} onClick={() => { setSelected(item); setNotice(''); }}>重置密码</button>
      <button className="action-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setNotice('');
        try { await api(`/admin/users/${item.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled }) }); await load(); }
        catch (err) { setError(errorText(err)); } finally { setBusy(false); }
      }}>{item.enabled ? '停用' : '启用'}</button>
    </div>)}</div>
    {selected && <form className="account-form" key={selected.id} onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
      try { await api(`/admin/users/${selected.id}/password`, { method: 'POST', body: JSON.stringify({ password: data.get('password') }) }); setNotice(`${selected.username} 的密码已重置`); setSelected(null); }
      catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}><label>重置 {selected.username} 的密码<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <div className="panel-actions"><button className="action-button" disabled={busy}>保存新密码</button><button type="button" className="action-button" onClick={() => setSelected(null)}>取消</button></div>
    </form>}
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
const count = (value: number | null) => value === null ? '未知' : value.toLocaleString();
const time = (value: number) => new Date(value).toLocaleString();
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
    {user.role === 'admin' && <div className="panel-actions"><button className="action-button" aria-pressed={!global} onClick={() => { setGlobal(false); setOffset(0); }}>我的用量</button><button className="action-button" aria-pressed={global} onClick={() => { setGlobal(true); setOffset(0); }}>全局用量</button></div>}
    <div className="usage-filters account-form">
      <label>开始时间<input type="datetime-local" value={filters.from} onChange={e => change('from', e.target.value)} /></label>
      <label>结束时间<input type="datetime-local" value={filters.to} onChange={e => change('to', e.target.value)} /></label>
      <label>模型标识<input list="usage-models" value={filters.modelId} placeholder="全部模型" onChange={e => change('modelId', e.target.value)} /><datalist id="usage-models">{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist></label>
      {global && <label>用户<select value={filters.userId} onChange={e => change('userId', e.target.value)}><option value="">全部用户</option>{users.map(item => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label>}
    </div>
    <button className="action-button" onClick={() => setRevision(value => value + 1)} disabled={loading}>刷新用量</button>
    {loading && <p role="status">读取用量…</p>}{error && <p role="alert" className="error-text">{error}</p>}
    {result && <><div className="usage-summary">
      <span>运行 {count(result.summary.runs)}</span><span>模型输入 {count(result.summary.inputTokens)}</span><span>模型输出 {count(result.summary.outputTokens)}</span>
      <span>缓存读 {count(result.summary.cacheReadTokens)}</span><span>缓存写 {count(result.summary.cacheWriteTokens)}</span><span>工具调用 {count(result.summary.toolCalls)}</span>
      <span>已知估算费用 ${result.summary.estimatedCost.toFixed(6)}</span><span>含未知字段记录 {count(result.summary.unknownRecords)}</span>
    </div><p className="muted-text">统计仅累加已知值；费用按管理员确认的单价估算，单位为美元，并非实际扣费。未确认价格或缺少用量时显示未知。</p>
      <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>时间 / 用户</th><th>模型 / 来源</th><th>类型 / 状态</th><th>Token 输入 / 输出</th><th>缓存 读 / 写</th><th>估算费用 / 耗时</th></tr></thead><tbody>{result.records.map(record => <tr key={record.id}>
        <td>{time(record.createdAt)}<small>{record.username}</small></td>
        <td>{record.modelId}<small>实际调用：{record.actualProvider ?? '未知提供方'} / {record.actualModel ?? '未知模型'}</small><details><summary>标识</summary><p>来源：{record.sourceId}</p><p>会话：{record.conversationId}</p><p>运行：{record.runId}</p></details></td>
        <td>{record.kind} / {record.status}<small>粒度：{record.granularity}</small></td>
        <td>{count(record.inputTokens)} / {count(record.outputTokens)}</td><td>{count(record.cacheReadTokens)} / {count(record.cacheWriteTokens)}</td>
        <td>{record.cost === null ? '未知' : `$${record.cost.toFixed(6)}`}<small>{record.durationMs === null ? '耗时未知' : `${record.durationMs} ms`}</small><small>{record.costBasis}</small></td>
      </tr>)}</tbody></table>{!result.records.length && <p>所选范围内没有用量记录</p>}</div>
      <div className="panel-actions"><button className="action-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>上一页</button><span>{result.total ? offset + 1 : 0}–{Math.min(offset + 50, result.total)} / {result.total}</span><button className="action-button" disabled={loading || offset + 50 >= result.total} onClick={() => setOffset(value => value + 50)}>下一页</button></div>
    </>}
  </section>;
}
