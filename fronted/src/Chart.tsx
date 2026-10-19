import { t, useLanguage } from './i18n';
import { memo, useId, useState, type CSSProperties } from 'react';
import { chartTable, chartTools, type PixelChart as ChartData, type CategoryChart } from '@pixel/contracts/charts';
import { colors, linePaths, axisNumber, shortLabel } from './chartGeometry';
import { PiePlot, ScatterPlot, HeatmapPlot } from './ChartPlots';
import { revealChartCell, useChartViewport } from './useChartViewport';
import './charts.css';

export const Chart = memo(function Chart({ chart, yRange, colorIndices, compact = false }: { chart: ChartData; yRange?: readonly [number, number]; colorIndices?: readonly number[]; compact?: boolean }) {
  useLanguage();
  const id = useId();
  const table = chartTable(chart);
  const label = t(Object.values(chartTools).find(tool => tool.kind === chart.kind)!.label);
  if (chart.kind === 'scatter') { table.headers[0] = t('系列'); table.headers[1] = t('标签'); }
  else if (chart.kind !== 'heatmap' && !chart.xLabel) table.headers[0] = t('分类');
  return <figure className="chart" aria-labelledby={`${id}-title`}>
    <figcaption id={`${id}-title`} className="chart-title"><span>{chart.title}</span><span className="chart-kind">{label}</span></figcaption>
    {chart.description && <p>{chart.description}</p>}
    {chart.kind === 'pie' ? <PiePlot chart={chart} /> : chart.kind === 'scatter' ? <ScatterPlot chart={chart} /> : chart.kind === 'heatmap' ? <HeatmapPlot chart={chart} /> : <CategoryPlot chart={chart} yRange={yRange} colorIndices={colorIndices} compact={compact} />}
    <details className="chart-data">
      <summary>{t("查看数据表（")}{table.rows.length} {" " + t("项）")}</summary>
      <div className="chart-table-scroll" tabIndex={0} role="region" aria-label={t("{0}原始数据", chart.title)}>
        <table>
          <caption>{chart.title}{chart.unit ? t("（{0}）", chart.unit) : ''}</caption>
          <thead><tr>{table.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell ?? t("缺失")}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
    {chart.source && <p className="chart-caption">{t("来源：")}{chart.source}</p>}
  </figure>;
});

function CategoryPlot({ chart, yRange, colorIndices, compact }: { chart: CategoryChart; yRange?: readonly [number, number]; colorIndices?: readonly number[]; compact: boolean }) {
  const id = useId();
  const { viewport, available } = useChartViewport();
  const [selected, setSelected] = useState(0);
  const selectedIndex = Math.min(selected, chart.labels.length - 1);
  const left = 88, right = 12, top = 12, plotHeight = 160;
  const slot = Math.max(48, chart.series.length * 10 + 8, Math.floor((available - left - right) / chart.labels.length));
  const width = left + chart.labels.length * slot + right;
  const bottom = top + plotHeight, height = bottom + 28;
  const values = chart.series.flatMap(series => series.values.filter((value): value is number => value !== null));
  // Normalize before arithmetic, including subnormal values and mixed signs.
  const range = yRange && Number.isFinite(yRange[0]) && Number.isFinite(yRange[1]) && yRange[0] < yRange[1] ? yRange : undefined;
  const magnitude = Math.max(...values.map(Math.abs), ...(range ?? []).map(Math.abs)) || 1;
  const minimum = range ? range[0] / magnitude : Math.min(0, ...values.map(value => value / magnitude));
  const maximum = range ? range[1] / magnitude : Math.max(0, ...values.map(value => value / magnitude)) || (minimum === 0 ? 1 : 0);
  const span = maximum - minimum;
  const yNormalized = (value: number) => top + Math.round((maximum - value) / span * plotHeight);
  const y = (value: number) => yNormalized(value / magnitude);
  const x = (index: number) => left + index * slot + Math.floor(slot / 2);
  const zero = yNormalized(0);
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - index * span / 4);
  const color = (index: number) => colors[(colorIndices?.[index] ?? index) % colors.length];
  const seriesStyle = (index: number) => ({ '--series-color': color(index) } as CSSProperties);

  function selectKey(event: React.KeyboardEvent<HTMLDivElement>) {
    let next = selectedIndex;
    if (event.key === 'ArrowRight') next++;
    else if (event.key === 'ArrowLeft') next--;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = chart.labels.length - 1;
    else return;
    event.preventDefault();
    next = Math.max(0, Math.min(chart.labels.length - 1, next));
    setSelected(next);
    const container = viewport.current;
    if (container) revealChartCell(container, left + next * slot, top, slot, plotHeight);
  }

  return <>
    <div className="chart-legend">{chart.series.map((series, index) => <span key={series.name} style={seriesStyle(index)}><i aria-hidden="true" />{index + 1}. {series.name}</span>)}</div>
    {(chart.yLabel || chart.unit) && <p className="chart-caption">{[chart.yLabel, chart.unit].filter(Boolean).join(' · ')}</p>}
    <div ref={viewport} className="chart-viewport" tabIndex={0} role="group" aria-label={t("图表绘图区，左右方向键选择分类，Home 和 End 跳到首尾")} aria-describedby={`${id}-selection`} onKeyDown={selectKey}>
      <div className="chart-plot" style={{ width: `${width}px`, height: `${height}px` }} onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const gridX = (event.clientX - rect.left) * width / rect.width;
        setSelected(Math.max(0, Math.min(chart.labels.length - 1, Math.floor((gridX - left) / slot))));
      }}>
        <svg width={`${width}px`} height={`${height}px`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {ticks.map((tick, index) => <rect key={index} x={left} y={yNormalized(tick)} width={width - left - right} height={1} fill="var(--chart-grid)" />)}
          <rect x={left} y={zero} width={width - left - right} height={1} fill="var(--line-strong)" />
          <rect x={x(selectedIndex)} y={top} width={1} height={plotHeight} fill="var(--line-strong)" opacity={0.6} />
          {chart.kind === 'area' && chart.series.map((series, seriesIndex) => linePaths(series.values, x, y).map((path, part) =>
            <path key={`${series.name}:${part}`} d={`${path.d}L${path.end} ${zero}L${path.start} ${zero}Z`} fill={color(seriesIndex)} fillOpacity={0.14} />))}
          {chart.series.map((series, seriesIndex) => <g key={series.name} fill={color(seriesIndex)}>
            {(chart.kind === 'line' || chart.kind === 'area') && linePaths(series.values, x, y).map((path, part) =>
              <path key={part} d={path.d} fill="none" stroke={color(seriesIndex)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {series.values.map((value, index) => {
              if (value === null) return null;
              if (chart.kind === 'line' || chart.kind === 'area') return <circle key={index} cx={x(index)} cy={y(value)} r={index === selectedIndex ? 4.5 : 3} stroke="var(--panel)" strokeWidth={1.5} />;
              const barWidth = Math.max(3, Math.min(28, Math.floor((slot - 12) / chart.series.length) - 2));
              const groupWidth = chart.series.length * (barWidth + 2) - 2;
              const barX = x(index) - Math.floor(groupWidth / 2) + seriesIndex * (barWidth + 2);
              const barHeight = Math.max(1, Math.abs(y(value) - zero));
              return <rect key={index} x={barX} y={Math.min(zero, y(value))} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2, barHeight / 2)} opacity={index === selectedIndex ? 1 : 0.85} />;
            })}
          </g>)}
        </svg>
        {ticks.map((tick, index) => <span key={index} className="chart-y-tick" style={{ left: '0px', top: `${yNormalized(tick) - 8}px`, width: `${left - 8}px` }}>{axisNumber(tick * magnitude)}</span>)}
        {chart.labels.map((label, index) => <span key={label} className="chart-x-tick" title={label} style={{ left: `${left + index * slot}px`, top: `${bottom + 8}px`, width: `${slot}px` }}>{shortLabel(label, slot - 4)}</span>)}
      </div>
    </div>
    {!compact && <p className="chart-caption">{chart.xLabel || t("分类")}{chart.kind !== 'bar' ? t(" · 等距分类轴") : ''}{chart.kind === 'area' ? t(" · 非堆叠") : ''} {" " + t("· 方向键或指针查看数值")}</p>}
    <div id={`${id}-selection`} className="chart-selection">
      <span>{chart.labels[selectedIndex]}</span>
      {chart.series.map((series, index) => <span key={series.name} style={seriesStyle(index)}><i aria-hidden="true" />{series.name}{t("：")}{series.values[selectedIndex] === null ? t("缺失") : `${series.values[selectedIndex]}${chart.unit ? ` ${chart.unit}` : ''}`}</span>)}
    </div>
  </>;
}
