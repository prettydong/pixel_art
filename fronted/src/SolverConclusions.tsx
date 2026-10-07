import { useEffect, useState } from 'react';
import type { ModelOption, RepairConclusion, RepairPanelData } from '@pixel/contracts';
import { api, errorText } from './api';
import { getLanguage, localizeMessage, t, useLanguage } from './i18n';
import { useAutoConclusions } from './solverPreferences';
import { RepairComparisonChart } from './RepairComparisonChart';
import { completedRepairGroups } from './repairComparisons';
import './RepairPanel.css';

const activeStatuses = ['queued', 'coding', 'compiling', 'running'];
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;


export function SolverConclusions({ taskId, revision, models }: { taskId: string; revision: number; models: ModelOption[] }) {
  useLanguage();
  const [autoConclusions] = useAutoConclusions();
  const [conclusion, setConclusion] = useState<RepairConclusion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      controller = new AbortController();
      try {
        const data = await api<RepairPanelData>(`/tasks/${encodeURIComponent(taskId)}/repairs`, { signal: controller.signal });
        if (!alive) return;
        setConclusion(data.conclusion ?? null); setError(''); setLoading(false);
        if (data.jobs.some(job => activeStatuses.includes(job.status))) timer = setTimeout(load, 2000);
      } catch (reason) {
        if (alive && (reason as Error).name !== 'AbortError') { setError(errorText(reason)); setLoading(false); timer = setTimeout(load, 4000); }
      }
    };
    void load();
    return () => { alive = false; controller?.abort(); clearTimeout(timer); };
  }, [taskId, revision, retry]);

  const jobs = conclusion?.jobs ?? [];
  const groups = completedRepairGroups(jobs);
  const completed = jobs.filter(job => job.status === 'completed' && job.summary).length;
  const active = jobs.filter(job => activeStatuses.includes(job.status)).length;
  const stopped = jobs.length - completed - active;
  return <section className="solver-conclusions" aria-label={t("Solver 结论")} aria-busy={loading}>
    <div className="task-record-heading"><h2>{t("Solver 结论")}</h2>{conclusion && <span className="task-note">{t("更新于 {0}", new Date(conclusion.updatedAt).toLocaleString(getLanguage()))}</span>}</div>
    {error && <div className="workspace-error" role="alert">{localizeMessage(error)}<button className="action-button" onClick={() => setRetry(value => value + 1)}>{t("重新读取")}</button></div>}
    {loading && <p className="task-note" role="status">{t("正在读取结论…")}</p>}
    {!autoConclusions && <p className="task-note">{t("自动结论已关闭；已有结论保留。")}</p>}
    {conclusion && <div className="solver-conclusion-status">
      <span>{t("已完成运行")} {completed}</span><span>{t("进行中")} {active}</span><span>{t("失败 / 取消 / 中断")} {stopped}</span>
    </div>}
    {!loading && !error && !groups.length && <p className="task-empty" role="status">{active ? t("等待 Solver 结果，结论将自动更新。") : conclusion ? t("暂无已完成的求解结果。") : autoConclusions ? t("启动 Solver 后自动生成结论。") : t("可在设置中开启自动结论。")}</p>}
    {active > 0 && groups.length > 0 && <p className="task-note" role="status">{t("部分结果 · 还有 {0} 项进行中", active)}</p>}
    <RepairComparisonChart jobs={jobs} models={models} />
    {!!groups.length && <details className="repair-result-details"><summary>{t("Wafer 详情（{0}）", groups.length)}</summary>
    {groups.map(({ key, rows }) => {
      const first = rows[0];
      const best = first.summary;
      const leaders = rows.filter(job => job.summary.passedChips === best.passedChips);
      return <article className="task-record" key={key}>
        <div className="task-record-heading"><h3>{first.waferName}</h3><span className="task-note">{first.productName}{first.synthetic ? t(" · 合成") : ''}</span></div>
        <p className="repair-result-insight">{t("Chip 最高通过率 {0}：{1}。比原始良率提升 {2} 个百分点。", percent(best.chipYield), leaders.map(job => job.architectureName).join(' / '), ((best.passedChips - best.initiallyGoodChips) / best.totalChips * 100).toFixed(2))}</p>
        <div className="repair-results-scroll" tabIndex={0} role="region" aria-label={t("{0} 结论对比表", first.waferName)}>
          <table className="repair-results-table"><thead><tr><th scope="col">{t("架构 / 编码引擎")}</th><th scope="col">{t("Chip 通过率")}</th><th scope="col">{t("Region 通过率")}</th><th scope="col">{t("未修成 / 总数")} Chip</th></tr></thead>
            <tbody>{rows.map(job => <tr key={job.id} className={leaders.includes(job) ? 'repair-result-leader' : undefined}>
              <th scope="row"><span>{job.architectureName}</span><small>{job.architectureFingerprint.slice(0, 8)} · {models.find(model => model.id === job.modelId)?.label ?? job.modelId}</small></th>
              <td><div className="repair-result-bar" role="img" aria-label={t("Chip 通过率 {0}", percent(job.summary.chipYield))}><i className="repair-bar-gain" style={{ width: `${Math.round(job.summary.chipYield * 160)}rem` }} /></div>{percent(job.summary.chipYield)}</td>
              <td>{percent(job.summary.regionYield)}</td><td>{job.summary.unresolvedChips} / {job.summary.totalChips}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>;
    })}
    </details>}
    {!!groups.length && <p className="task-note">{t("使用同一 wafer 输入下各架构版本 / 引擎的最近已完成结果。repairMost 未修成不代表已证明无解。")}</p>}
    {stopped > 0 && <details><summary>{t("失败 / 取消 / 中断")} ({stopped})</summary>{jobs.filter(job => !activeStatuses.includes(job.status) && job.status !== 'completed').map(job => <p key={job.id}>{job.architectureName} × {job.waferName} · {localizeMessage(job.error ?? job.status)}</p>)}</details>}
  </section>;
}
