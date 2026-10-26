import { Component, lazy, Suspense, type ReactNode } from 'react';
import { t, useLanguage } from './i18n';
import { AuthGate } from './AuthGate';
import { Spark } from './Icons';

const Workspace = lazy(() => import('./Workspace'));
const ChartDemo = lazy(() => import('./ChartDemo').then(module => ({ default: module.ChartDemo })));

function LoadingWorkspace() {
  return <main className="auth-page"><p role="status" className="auth-loading"><Spark className="thinking-spark" />{t("正在连接工作台…")}</p></main>;
}

class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="auth-page"><div className="account-form">
      <p role="alert" className="error-text">{t("资源载入失败，请刷新重试。")}</p>
      <button className="action-button" onClick={() => window.location.reload()}>{t("重新连接")}</button>
    </div></main>;
    return this.props.children;
  }
}

export default function App() {
  useLanguage();
  const demo = new URLSearchParams(window.location.search).get('demo');
  return <LoadBoundary><Suspense fallback={<LoadingWorkspace />}>
    {demo === 'charts' ? <ChartDemo /> : demo === 'tools'
      ? <Workspace demoMode user={{ id: 'local-demo', username: t("离线演示"), role: 'user', enabled: true, createdAt: 0 }} />
      : <AuthGate>{user => <Workspace user={user} />}</AuthGate>}
  </Suspense></LoadBoundary>;
}
