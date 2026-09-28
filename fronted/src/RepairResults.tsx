import { useEffect, useMemo, useState } from 'react';
import type { ModelOption, RepairJob, RepairSummary, TaskArchitecture } from '@pixel/contracts';
import { BarChart } from './PixelIcons';

type CompleteJob = RepairJob & { summary: RepairSummary };
type Metric = 'chip' | 'region';
type ResultGroup = { key: string; name: string; jobs: CompleteJob[] };
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
function counts(job: CompleteJob, metric: Metric) {
  const summary = job.summary;
  return metric === 'chip'
    ? { total: summary.totalChips, initial: summary.initiallyGoodChips, passed: summary.passedChips, unresolved: summary.unresolvedChips }
    : { total: summary.totalRegions, initial: summary.initiallyGoodRegions, passed: summary.passedRegions, unresolved: summary.unresolvedRegions };
}
function elapsed(job: RepairJob) {
  if (job.startedAt === null || job.finishedAt === null) return '—';
  const seconds = Math.max(0, (job.finishedAt - job.startedAt) / 1000);
  return seconds < 60 ? `${seconds.toFixed(1)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

export function RepairResults({ jobs, architectures, models }: { jobs: RepairJob[]; architectures: TaskArchitecture[]; models: ModelOption[] }) {
  const [metric, setMetric] = useState<Metric>('chip');
  const [groupKey, setGroupKey] = useState('');
  const [history, setHistory] = useState(false);
  const groups = useMemo(() => {
    const result = new Map<string, ResultGroup>();
    for (const job of jobs) {
      if (job.status !== 'completed' || !job.summary) continue;
      const summary = job.summary;
      // Compare matching wafer baselines only, even if historical dataset metadata changed.
      const key = JSON.stringify([job.waferId, job.synthetic, summary.totalChips, summary.totalRegions, summary.initiallyGoodChips, summary.initiallyGoodRegions]);
      let group = result.get(key);
      if (!group) {
        group = { key, name: `${job.waferName} · ${job.productName}${job.synthetic ? ' · 合成' : ''} · ${summary.totalChips.toLocaleString()} chip / ${summary.totalRegions.toLocaleString()} region · 原始良品 ${summary.initiallyGoodChips.toLocaleString()} chip / ${summary.initiallyGoodRegions.toLocaleString()} region`, jobs: [] };
        result.set(key, group);
      }
      group.jobs.push({ ...job, summary });
    }
    return [...result.values()];
  }, [jobs]);
  useEffect(() => {
    if (groups.length && !groups.some(item => item.key === groupKey)) setGroupKey(groups[0].key);
  }, [groups, groupKey]);
  const group = groups.find(item => item.key === groupKey) ?? groups[0];
  const rows = useMemo(() => {
    const sorted = [...(group?.jobs ?? [])].sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const seen = new Set<string>();
    return sorted.filter(job => {
      if (history) return true;
      const key = JSON.stringify([job.architectureId, job.architectureFingerprint, job.modelId]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => counts(b, metric).passed - counts(a, metric).passed);
  }, [group, history, metric]);
  const completed = jobs.filter(job => job.status === 'completed' && job.summary).length;
  const active = jobs.filter(job => ['queued', 'coding', 'compiling', 'running'].includes(job.status)).length;
  const stopped = jobs.length - completed - active;
  const unit = metric === 'chip' ? 'Chip' : 'Region';
  const best = rows[0] ? counts(rows[0], metric) : null;
  const leaders = best ? rows.filter(job => counts(job, metric).passed === best.passed) : [];

  return <section className="repair-results" aria-label="结果分析">
    <div className="repair-job-heading"><h2><BarChart />结果分析</h2><span className="task-note">完成 {completed} · 进行中 {active} · 失败 / 取消 / 中断 {stopped}</span></div>
    {!group || !best ? <p className="task-empty">暂无结果</p> : <>
      <div className="repair-analysis-controls">
        <label className="repair-wafer-filter">对比 wafer<select value={group.key} onChange={event => setGroupKey(event.target.value)}>{groups.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        <label>统计单位<select value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="chip">Chip</option><option value="region">Region</option></select></label>
        <label className="repair-check"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />包含重复运行</label>
      </div>
      {rows.length > 1 && <p className="repair-result-insight">最高良率 {percent(best.passed / best.total)} · {leaders.length > 1 ? `${leaders.length} 项并列` : rows[0].architectureName} · 提升 {((best.passed - best.initial) / best.total * 100).toFixed(2)} 个百分点</p>}
      <div className="repair-chart-legend"><span><i className="repair-bar-initial" />原始良品</span><span><i className="repair-bar-gain" />新增修成</span><span><i className="repair-bar-unresolved" />未修成</span><span>0–100%</span></div>
      <div className="repair-results-scroll" tabIndex={0} role="region" aria-label={`${unit} 良率对比表，可横向滚动`}>
        <table className="repair-results-table"><caption>{unit} · {history ? '全部结果' : '各版本 / 引擎最近结果'} · {rows.length} 项</caption>
          <thead><tr><th scope="col">架构 / 编码引擎</th><th scope="col">良率构成</th><th scope="col">修补后良率</th><th scope="col">提升（百分点）</th><th scope="col">新增修成</th><th scope="col">未修成 / 总数</th><th scope="col">总耗时</th></tr></thead>
          <tbody>{rows.map(job => {
            const value = counts(job, metric);
            const initialWidth = Math.round(value.initial / value.total * 160);
            const passedWidth = Math.round(value.passed / value.total * 160);
            const current = architectures.find(item => item.id === job.architectureId);
            const historical = !current || current.fingerprint !== job.architectureFingerprint;
            const chartLabel = `原始良品 ${value.initial.toLocaleString()}，新增修成 ${(value.passed - value.initial).toLocaleString()}，未修成 ${value.unresolved.toLocaleString()}，共 ${value.total.toLocaleString()} ${unit}`;
            return <tr key={job.id}>
              <th scope="row"><span title={job.architectureName}>{job.architectureName}</span><small>{job.architectureFingerprint.slice(0, 8)}{historical ? ' · 历史架构' : ''}</small><small>{models.find(model => model.id === job.modelId)?.label ?? job.modelId}</small><small>{new Date(job.finishedAt ?? job.createdAt).toLocaleString()}</small></th>
              <td><div className="repair-result-bar" role="img" aria-label={chartLabel} title={chartLabel}><i className="repair-bar-initial" style={{ width: `${initialWidth}rem` }} /><i className="repair-bar-gain" style={{ width: `${passedWidth - initialWidth}rem` }} /><i className="repair-bar-unresolved" style={{ width: `${160 - passedWidth}rem` }} /></div><small>原始 {percent(value.initial / value.total)}</small></td>
              <td>{percent(value.passed / value.total)}</td><td>+{((value.passed - value.initial) / value.total * 100).toFixed(2)}</td><td>{(value.passed - value.initial).toLocaleString()}</td><td>{value.unresolved.toLocaleString()} / {value.total.toLocaleString()}</td><td>{elapsed(job)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
