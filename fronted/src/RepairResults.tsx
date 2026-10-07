import { getLanguage, t, useLanguage } from './i18n';
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
  return seconds < 60 ? t("{0} 秒", seconds.toFixed(1)) : t("{0} 分 {1} 秒", Math.floor(seconds / 60), Math.floor(seconds % 60));
}

export function RepairResults({ jobs, architectures, models }: { jobs: RepairJob[]; architectures: TaskArchitecture[]; models: ModelOption[] }) {
  const [language] = useLanguage();
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
        group = { key, name: t("{0} · {1}{2} · {3} chip / {4} region · 原始良品 {5} chip / {6} region", job.waferName, job.productName, job.synthetic ? t(" · 合成") : '', summary.totalChips.toLocaleString(getLanguage()), summary.totalRegions.toLocaleString(getLanguage()), summary.initiallyGoodChips.toLocaleString(getLanguage()), summary.initiallyGoodRegions.toLocaleString(getLanguage())), jobs: [] };
        result.set(key, group);
      }
      group.jobs.push({ ...job, summary });
    }
    return [...result.values()];
  }, [jobs, language]);
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

  return <section className="repair-results" aria-label={t("结果分析")}>
    <div className="repair-job-heading"><h2><BarChart />{t("结果分析")}</h2><span className="task-note">{t("完成") + " "}{completed} {" " + t("· 进行中") + " "}{active} {" " + t("· 失败 / 取消 / 中断") + " "}{stopped}</span></div>
    {!group || !best ? <p className="task-empty">{t("暂无结果")}</p> : <>
      <div className="repair-analysis-controls">
        <label className="repair-wafer-filter">{t("对比 wafer")}<select value={group.key} onChange={event => setGroupKey(event.target.value)}>{groups.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        <label>{t("统计单位")}<select value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="chip">Chip</option><option value="region">Region</option></select></label>
        <label className="repair-check"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />{t("包含重复运行")}</label>
      </div>
      {rows.length > 1 && <p className="repair-result-insight">{t("最高良率") + " "}{percent(best.passed / best.total)} · {leaders.length > 1 ? t("{0} 项并列", leaders.length) : rows[0].architectureName} {" " + t("· 提升") + " "}{((best.passed - best.initial) / best.total * 100).toFixed(2)} {" " + t("个百分点")}</p>}
      <div className="repair-chart-legend"><span><i className="repair-bar-initial" />{t("原始良品")}</span><span><i className="repair-bar-gain" />{t("新增修成")}</span><span><i className="repair-bar-unresolved" />{t("未修成")}</span><span>0–100%</span></div>
      <div className="repair-results-scroll" tabIndex={0} role="region" aria-label={t("{0} 良率对比表，可横向滚动", unit)}>
        <table className="repair-results-table"><caption>{unit} · {history ? t("全部结果") : t("各版本 / 引擎最近结果")} · {rows.length} {" " + t("项")}</caption>
          <thead><tr><th scope="col">{t("架构 / 编码引擎")}</th><th scope="col">{t("良率构成")}</th><th scope="col">{t("修补后良率")}</th><th scope="col">{t("提升（百分点）")}</th><th scope="col">{t("新增修成")}</th><th scope="col">{t("未修成 / 总数")}</th><th scope="col">{t("总耗时")}</th></tr></thead>
          <tbody>{rows.map(job => {
            const value = counts(job, metric);
            const initialWidth = Math.round(value.initial / value.total * 160);
            const passedWidth = Math.round(value.passed / value.total * 160);
            const current = architectures.find(item => item.id === job.architectureId);
            const historical = !current || current.fingerprint !== job.architectureFingerprint;
            const chartLabel = t("原始良品 {0}，新增修成 {1}，未修成 {2}，共 {3} {4}", value.initial.toLocaleString(getLanguage()), (value.passed - value.initial).toLocaleString(getLanguage()), value.unresolved.toLocaleString(getLanguage()), value.total.toLocaleString(getLanguage()), unit);
            return <tr key={job.id}>
              <th scope="row"><span title={job.architectureName}>{job.architectureName}</span><small>{job.architectureFingerprint.slice(0, 8)}{historical ? t(" · 历史架构") : ''}</small><small>{models.find(model => model.id === job.modelId)?.label ?? job.modelId}</small><small>{new Date(job.finishedAt ?? job.createdAt).toLocaleString(getLanguage())}</small></th>
              <td><div className="repair-result-bar" role="img" aria-label={chartLabel} title={chartLabel}><i className="repair-bar-initial" style={{ width: `${initialWidth}rem` }} /><i className="repair-bar-gain" style={{ width: `${passedWidth - initialWidth}rem` }} /><i className="repair-bar-unresolved" style={{ width: `${160 - passedWidth}rem` }} /></div><small>{t("原始") + " "}{percent(value.initial / value.total)}</small></td>
              <td>{percent(value.passed / value.total)}</td><td>+{((value.passed - value.initial) / value.total * 100).toFixed(2)}</td><td>{(value.passed - value.initial).toLocaleString(getLanguage())}</td><td>{value.unresolved.toLocaleString(getLanguage())} / {value.total.toLocaleString(getLanguage())}</td><td>{elapsed(job)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
