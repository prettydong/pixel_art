import { memo, useId, useState, type CSSProperties } from 'react';
import { chartTable, chartTools, type PixelChart as ChartData, type CategoryChart } from '@pixel/contracts/charts';
import { colors, pixelLine, axisNumber, shortLabel } from './chartGeometry';
import { PiePlot, ScatterPlot, HeatmapPlot } from './ChartPlots';
import { revealChartCell, useChartViewport } from './useChartViewport';
import './pixelCharts.css';

export const PixelChart = memo(function PixelChart({ chart }: { chart: ChartData }) {
  const id = useId();
  const table = chartTable(chart);
  const label = Object.values(chartTools).find(tool => tool.kind === chart.kind)!.label;
  return <figure className="pixel-chart" aria-labelledby={`${id}-title`}>
    <figcaption id={`${id}-title`} className="pixel-chart-title"><span>{chart.title}</span><span className="pixel-chart-kind">{label}</span></figcaption>
    {chart.description && <p>{chart.description}</p>}
    {chart.kind === 'pie' ? <PiePlot chart={chart} /> : chart.kind === 'scatter' ? <ScatterPlot chart={chart} /> : chart.kind === 'heatmap' ? <HeatmapPlot chart={chart} /> : <CategoryPlot chart={chart} />}
    <details className="pixel-chart-data">
      <summary>查看数据表（{table.rows.length} 项）</summary>
      <div className="pixel-chart-table-scroll" tabIndex={0} role="region" aria-label={`${chart.title}原始数据`}>
        <table>
          <caption>{chart.title}{chart.unit ? `（${chart.unit}）` : ''}</caption>
          <thead><tr>{table.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell ?? '缺失'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
    {chart.source && <p className="pixel-chart-caption">来源：{chart.source}</p>}
  </figure>;
});

function CategoryPlot({ chart }: { chart: CategoryChart }) {
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
  const magnitude = Math.max(...values.map(Math.abs)) || 1;
  const minimum = Math.min(0, ...values.map(value => value / magnitude));
  const maximum = Math.max(0, ...values.map(value => value / magnitude)) || (minimum === 0 ? 1 : 0);
  const span = maximum - minimum;
  const yNormalized = (value: number) => top + Math.round((maximum - value) / span * plotHeight);
  const y = (value: number) => yNormalized(value / magnitude);
  const x = (index: number) => left + index * slot + Math.floor(slot / 2);
  const zero = yNormalized(0);
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - index * span / 4);
  const seriesStyle = (index: number) => ({ '--series-color': colors[index] } as CSSProperties);

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
    <div className="pixel-chart-legend">{chart.series.map((series, index) => <span key={series.name} style={seriesStyle(index)}><i aria-hidden="true" />{index + 1}. {series.name}</span>)}</div>
    {(chart.yLabel || chart.unit) && <p className="pixel-chart-caption">{[chart.yLabel, chart.unit].filter(Boolean).join(' · ')}</p>}
    <div ref={viewport} className="pixel-chart-viewport" tabIndex={0} role="group" aria-label="图表绘图区，左右方向键选择分类，Home 和 End 跳到首尾" aria-describedby={`${id}-selection`} onKeyDown={selectKey}>
      <div className="pixel-chart-plot" style={{ width: `${width}rem`, height: `${height}rem` }} onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const gridX = (event.clientX - rect.left) * width / rect.width;
        setSelected(Math.max(0, Math.min(chart.labels.length - 1, Math.floor((gridX - left) / slot))));
      }}>
        <svg width={`${width}rem`} height={`${height}rem`} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
          <defs>{chart.series.map((series, index) => <pattern key={series.name} id={`${id}-area-${index}`} width={4} height={4} patternUnits="userSpaceOnUse"><rect x={(index % 2) * 2} y={Math.floor(index / 2) * 2} width={1} height={1} fill={colors[index]} /></pattern>)}</defs>
          <rect x={left + selectedIndex * slot} y={top} width={slot} height={plotHeight} fill="var(--chart-highlight)" />
          {ticks.map((tick, index) => <rect key={index} x={left} y={yNormalized(tick)} width={width - left - right} height={1} fill="var(--chart-grid)" />)}
          <rect x={left} y={top} width={1} height={plotHeight + 1} fill="var(--muted)" />
          <rect x={left} y={zero} width={width - left - right} height={1} fill="var(--muted)" />
          {chart.kind === 'area' && chart.series.map((series, seriesIndex) => <g key={series.name} fill={`url(#${id}-area-${seriesIndex})`}>{series.values.flatMap((value, index) => {
            const previous = series.values[index - 1];
            if (value === null || previous == null) return [];
            return pixelLine(x(index - 1), y(previous), x(index), y(value)).map((run, segment) => <rect key={`${index}:${segment}`} x={run.x} y={Math.min(run.y, zero)} width={run.width} height={Math.max(1, Math.abs(run.y - zero))} />);
          })}</g>)}
          {chart.series.map((series, seriesIndex) => <g key={series.name} fill={colors[seriesIndex]}>
            {(chart.kind === 'line' || chart.kind === 'area') && series.values.flatMap((value, index) => {
              const previous = series.values[index - 1];
              if (value === null || previous == null) return [];
              return pixelLine(x(index - 1), y(previous), x(index), y(value)).map((run, segment) => <rect key={`${index}:${segment}`} {...run} height={1} />);
            })}
            {series.values.map((value, index) => {
              if (value === null) return null;
              if (chart.kind === 'line' || chart.kind === 'area') return <rect key={index} x={x(index) - 1} y={y(value) - 1} width={3} height={3} />;
              const barWidth = Math.max(3, Math.floor((slot - 12) / chart.series.length) - 2);
              const groupWidth = chart.series.length * (barWidth + 2) - 2;
              const barX = x(index) - Math.floor(groupWidth / 2) + seriesIndex * (barWidth + 2);
              return <rect key={index} x={barX} y={Math.min(zero, y(value))} width={barWidth} height={Math.max(1, Math.abs(y(value) - zero))} />;
            })}
          </g>)}
        </svg>
        {ticks.map((tick, index) => <span key={index} className="pixel-chart-y-tick" style={{ left: '0rem', top: `${yNormalized(tick) - 8}rem`, width: `${left - 8}rem` }}>{axisNumber(tick * magnitude)}</span>)}
        {chart.labels.map((label, index) => <span key={label} className="pixel-chart-x-tick" title={label} style={{ left: `${left + index * slot}rem`, top: `${bottom + 8}rem`, width: `${slot}rem` }}>{shortLabel(label, slot - 4)}</span>)}
      </div>
    </div>
    <p className="pixel-chart-caption">{chart.xLabel || '分类'}{chart.kind !== 'bar' ? ' · 等距分类轴' : ''}{chart.kind === 'area' ? ' · 非堆叠' : ''} · 方向键或指针查看数值</p>
    <div id={`${id}-selection`} className="pixel-chart-selection">
      <span>{chart.labels[selectedIndex]}</span>
      {chart.series.map((series, index) => <span key={series.name} style={seriesStyle(index)}><i aria-hidden="true" />{series.name}：{series.values[selectedIndex] === null ? '缺失' : `${series.values[selectedIndex]}${chart.unit ? ` ${chart.unit}` : ''}`}</span>)}
    </div>
  </>;
}
