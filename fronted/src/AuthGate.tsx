import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@pixel/contracts';
import { api, errorText, RequestError } from './api';
export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const clear = () => setUser(null);
    window.addEventListener('pixel:unauthorized', clear);
    api<{ user: User }>('/me').then(data => { if (alive) setUser(data.user); }).catch(e => {
      if (alive && (!(e instanceof RequestError) || e.status !== 401)) setError(errorText(e));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; window.removeEventListener('pixel:unauthorized', clear); };
  }, []);
  if (loading) return <main className="auth-page"><p role="status">正在连接工作台…</p></main>;
  if (user) return children(user);
  return <main className="auth-page"><form className="account-form auth-form" onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
    try { const result = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) }); setUser(result.user); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }}><h1>PIXEL CHAT</h1><p>登录评估工作台</p>
    <label>用户名<input name="username" autoComplete="username" defaultValue={import.meta.env.DEV ? 'admin' : ''} required maxLength={64} autoFocus /></label>
    <label>密码<input name="password" type="password" autoComplete="current-password" defaultValue={import.meta.env.DEV ? '123' : ''} required maxLength={256} /></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="action-button primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
    <small>账号由管理员创建。原浏览器演示对话保留在本地，不会自动上传。</small>
    <a className="action-button" href="?demo=tools">打开本地工具演示</a>
    <a className="action-button" href="?demo=charts">查看像素图表演示</a>
  </form></main>;
}
