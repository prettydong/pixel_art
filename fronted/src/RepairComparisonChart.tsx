import { useMemo, useState } from 'react';
import type { ModelOption, RepairJob } from '@pixel/contracts';
import type { CategoryChart } from '@pixel/contracts/charts';
import { PixelChart } from './PixelChart';
import { completedRepairGroups, repairSeriesKey, type CompletedRepair } from './repairComparisons';
import { t, useLanguage } from './i18n';
import './RepairComparisonChart.css';

type Metric = 'chip' | 'region' | 'gain';
const MAX_SERIES = 12;
function metricCounts(job: CompletedRepair, metric: Metric) {
  const s = job.summary;
  return metric === 'region' ? [s.passedRegions, s.totalRegions] : [metric === 'gain' ? s.passedChips - s.initiallyGoodChips : s.passedChips, s.totalChips];
}

export function RepairComparisonChart({ jobs, models }: { jobs: RepairJob[]; models: ModelOption[] }) {
  const [language] = useLanguage();
  const [kind, setKind] = useState<'bar' | 'line'>('bar');
  const [metric, setMetric] = useState<Metric>('chip');
  const [productKey, setProductKey] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const products = useMemo(() => {
    const map = new Map<string, ReturnType<typeof completedRepairGroups>>();
    for (const group of completedRepairGroups(jobs)) {
      const job = group.rows[0];
      // Real / synthetic data and differing region counts must not share an aggregate.
      const key = JSON.stringify([job.productName, job.synthetic, job.summary.totalRegions / job.summary.totalChips]);
      const groups = map.get(key) ?? []; groups.push(group); map.set(key, groups);
    }
    return [...map].map(([key, groups]) => ({ key, groups, name: `${groups[0].rows[0].productName}${groups[0].rows[0].synthetic ? t(' · 合成') : ''} · ${groups[0].rows[0].summary.totalRegions / groups[0].rows[0].summary.totalChips} region/chip` }));
  }, [jobs, language]);
  const product = products.find(item => item.key === productKey) ?? products[0];
  const groups = product?.groups ?? [];
  const configs = [...new Map(groups.flatMap(group => group.rows).map(job => [repairSeriesKey(job), job])).entries()]
    .sort((a, b) => a[1].architectureName.localeCompare(b[1].architectureName, undefined, { numeric: true }) || a[0].localeCompare(b[0]));
  const chosen = configs.filter(([key], index) => selected ? selected.has(key) : index < MAX_SERIES);
  const metricLabel = metric === 'region' ? t('Region 通过率') : metric === 'gain' ? t('Chip 良率提升') : t('Chip 通过率');
  const unit = metric === 'gain' ? t('百分点') : '%';
  const hasSeveralEngines = new Set(configs.map(([, job]) => job.modelId)).size > 1;
  function configLabel(job: CompletedRepair) {
    const versions = configs.filter(([, other]) => other.architectureName === job.architectureName && other.architectureFingerprint !== job.architectureFingerprint);
    const duplicateId = configs.some(([, other]) => other.architectureName === job.architectureName && other.architectureFingerprint === job.architectureFingerprint && other.architectureId !== job.architectureId);
    return `${job.architectureName}${versions.length ? ` · ${job.architectureFingerprint.slice(0, 8)}` : ''}${duplicateId ? ` · ${job.architectureId.slice(0, 8)}` : ''}${hasSeveralEngines ? ` · ${models.find(model => model.id === job.modelId)?.label ?? job.modelId}` : ''}`;
  }
  const chart: CategoryChart = {
    kind, title: t('跨 wafer 对比'), xLabel: 'Wafer', yLabel: metricLabel, unit,
    labels: groups.map(group => {
      const job = group.rows[0];
      const duplicate = groups.some(other => other.key !== group.key && other.rows[0].waferName === job.waferName);
      return `${job.waferName}${duplicate ? ` · ${job.inputHash?.slice(0, 8) ?? job.waferId.slice(0, 8)} · ${groups.indexOf(group) + 1}` : ''}`;
    }),
    series: chosen.map(([key, job]) => ({ name: configLabel(job), values: groups.map(group => {
      const match = group.rows.find(row => repairSeriesKey(row) === key);
      if (!match) return null;
      const [passed, total] = metricCounts(match, metric);
      return Number((passed / total * 100).toFixed(2));
    }) })),
  };
  // Rank only on the intersection of identical wafer inputs, weighted by chip / region counts.
  const shared = groups.filter(group => chosen.length > 0 && chosen.every(([key]) => group.rows.some(job => repairSeriesKey(job) === key)));
  const ranked = chosen.map(([key, job]) => {
    const totals = shared.reduce((sum, group) => {
      const [passed, total] = metricCounts(group.rows.find(row => repairSeriesKey(row) === key)!, metric);
      return [sum[0] + passed, sum[1] + total];
    }, [0, 0]);
    return { job, value: totals[1] ? totals[0] / totals[1] * 100 : 0 };
  }).sort((a, b) => b.value - a.value);
  const winners = ranked.filter(item => Math.abs(item.value - (ranked[0]?.value ?? 0)) < 1e-9);
  const toggle = (key: string) => {
    const next = new Set(chosen.map(([id]) => id));
    if (next.has(key)) next.delete(key); else if (next.size < MAX_SERIES) next.add(key);
    setSelected(next);
  };
  if (!groups.length) return null;
  return <section className="repair-comparison" aria-label={t('图表分析')}>
    <div className="repair-comparison-toolbar">
      <div className="repair-comparison-types" role="group" aria-label={t('图表类型')}>
        <button className="action-button" aria-pressed={kind === 'bar'} onClick={() => setKind('bar')}>{t('柱状图')}</button>
        <button className="action-button" aria-pressed={kind === 'line'} onClick={() => setKind('line')}>{t('折线图')}</button>
      </div>
      <label className="visually-hidden" htmlFor={`metric-${jobs[0]?.taskId}`}>{t('图表指标')}</label>
      <select id={`metric-${jobs[0]?.taskId}`} aria-label={t('图表指标')} value={metric} onChange={event => setMetric(event.target.value as Metric)}>
        <option value="chip">{t('Chip 通过率')}</option><option value="region">{t('Region 通过率')}</option><option value="gain">{t('Chip 良率提升')}</option>
      </select>
      {products.length > 1 && <select aria-label={t('对比产品')} value={product.key} onChange={event => { setProductKey(event.target.value); setSelected(null); }}>
        {products.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
      </select>}
      <details className="repair-comparison-variants"><summary>{t('变体 {0}/{1}', chosen.length, configs.length)}</summary>
        <div className="repair-comparison-options">{configs.map(([key, job]) => <label className="repair-check" key={key}><input type="checkbox" checked={chosen.some(([id]) => id === key)} disabled={chosen.length >= MAX_SERIES && !chosen.some(([id]) => id === key)} onChange={() => toggle(key)} />{configLabel(job)}</label>)}</div>
        {configs.length > MAX_SERIES && <p className="task-note">{t('同时最多显示 {0} 个变体', MAX_SERIES)}</p>}
      </details>
    </div>
    {shared.length > 0 && <p className="repair-result-insight">{t('{0} · 最高 {1}{2} · {3} · {4} 片共同 wafer', metricLabel, ranked[0].value.toFixed(2), unit, winners.map(item => configLabel(item.job)).join(' / '), shared.length)}</p>}
    {!shared.length && chosen.length > 1 && <p className="task-note">{t('所选变体暂无共同 wafer，暂不汇总排名。')}</p>}
    {chosen.length ? <PixelChart key={product.key} chart={chart} yRange={[0, 100]} colorIndices={chosen.map(([key]) => configs.findIndex(([id]) => key === id))} compact /> : <p className="task-empty">{t('选择至少一个变体')}</p>}
  </section>;
}
