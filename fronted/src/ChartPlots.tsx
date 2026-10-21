import { t } from './i18n';
import { Hint } from './Hint';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { CategoryChart, ScatterChart, HeatmapChart } from '@pixel/contracts/charts';
import { axisNumber, colors, shortLabel } from './chartGeometry';
import { revealChartCell, useChartViewport } from './useChartViewport';

const colorStyle = (index: number) => ({ '--series-color': colors[index] } as CSSProperties);
const unitValue = (value: number | null, unit?: string) => value === null ? t("缺失") : `${value}${unit ? ` ${unit}` : ''}`;

export function PiePlot({ chart }: { chart: CategoryChart }) {
  const [selected, setSelected] = useState(0);
  const size = 160, center = 80, radius = 76;
  const values = chart.series[0].values;
  const largest = Math.max(...values.map(value => value ?? 0));
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0) / largest, 0);
  const proportions = values.map(value => (value ?? 0) / largest / total);
  const paths = useMemo(() => {
    let angle = -Math.PI / 2;
    return proportions.map(share => {
      const startAngle = angle; angle += share * 2 * Math.PI;
      if (!(share > 0)) return '';
      if (share >= 0.9999) return `M${center} ${center - radius}A${radius} ${radius} 0 1 1 ${center - 0.01} ${center - radius}Z`;
      const point = (value: number) => `${(center + radius * Math.cos(value)).toFixed(2)} ${(center + radius * Math.sin(value)).toFixed(2)}`;
      return `M${center} ${center}L${point(startAngle)}A${radius} ${radius} 0 ${share > 0.5 ? 1 : 0} 1 ${point(angle)}Z`;
    });
  }, [chart]);
  return <div className="chart-pie">
    <svg width={`${size}px`} height={`${size}px`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("{0}；各分类数值和占比见旁边列表", chart.title)}>
      {paths.map((path, index) => <path key={index} d={path} fill={colors[index]} stroke="var(--panel)" strokeWidth={1.5} strokeLinejoin="round" opacity={selected === index ? 1 : 0.82} onPointerEnter={() => setSelected(index)}><title>{chart.labels[index]}{t("：")}{unitValue(values[index], chart.unit)}{t("（")}{(proportions[index] * 100).toFixed(1)}{t("%）")}</title></path>)}
    </svg>
    <div className="chart-pie-legend">{chart.labels.map((label, index) => <button key={label} type="button" className={selected === index ? 'is-selected' : ''} style={colorStyle(index)} onClick={() => setSelected(index)} onFocus={() => setSelected(index)} aria-pressed={selected === index}>
      <i aria-hidden="true" /><span>{index + 1}. {label}{t("：")}{unitValue(values[index], chart.unit)} · {values[index] === null ? t("无占比") : `${(proportions[index] * 100).toFixed(1)}%`}</span>
    </button>)}</div>
    <p className="chart-caption">{chart.series[0].name}<Hint>{t("占比按有效数值总和计算，缺失值不计入总和。")}</Hint></p>
  </div>;
}

function numericScale(values: number[]) {
  const magnitude = Math.max(...values.map(Math.abs)) || 1;
  let min = Math.min(...values.map(value => value / magnitude));
  let max = Math.max(...values.map(value => value / magnitude));
  if (min === max) { min -= 0.5; max += 0.5; }
  return { min, max, magnitude, fraction: (value: number) => (value / magnitude - min) / (max - min) };
}

export function ScatterPlot({ chart }: { chart: ScatterChart }) {
  const id = useId();
  const { viewport, available } = useChartViewport();
  const [selected, setSelected] = useState(0);
  const points = chart.series.flatMap((series, seriesIndex) => series.points.map((point, index) => ({ ...point, series: series.name, seriesIndex, label: point.label || t("点 {0}", index + 1) })));
  const point = points[Math.min(selected, points.length - 1)];
  const width = Math.max(360, available), height = 208, left = 88, top = 12, plotWidth = width - left - 48, plotHeight = 160;
  const xs = numericScale(points.map(point => point.x)), ys = numericScale(points.map(point => point.y));
  const x = (value: number) => left + Math.round(xs.fraction(value) * plotWidth);
  const y = (value: number) => top + plotHeight - Math.round(ys.fraction(value) * plotHeight);
  const ticks = [0, 1, 2, 3, 4];
  return <>
    <div className="chart-legend">{chart.series.map((series, index) => <span key={series.name} style={colorStyle(index)}><i aria-hidden="true" />{series.name}</span>)}</div>
    <p className="chart-caption">{chart.yLabel || 'Y'}{chart.unit ? ` · ${chart.unit}` : ''}</p>
    <div ref={viewport} className="chart-viewport" tabIndex={0} role="group" aria-label={t("散点图，左右方向键逐点查看，Home 和 End 跳到首尾")} aria-describedby={`${id}-selection`} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)));
      setSelected(next);
      revealChartCell(event.currentTarget, x(points[next].x) - 8, y(points[next].y) - 8, 16, 16);
    }}>
      <div className="chart-plot" style={{ width: `${width}px`, height: `${height}px` }}>
        <svg width={`${width}px`} height={`${height}px`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {ticks.map(tick => <g key={tick} fill="var(--chart-grid)"><rect x={left + Math.round(plotWidth * tick / 4)} y={top} width={1} height={plotHeight} /><rect x={left} y={top + plotHeight - Math.round(plotHeight * tick / 4)} width={plotWidth} height={1} /></g>)}
          <rect x={left} y={top + plotHeight} width={plotWidth} height={1} fill="var(--line-strong)" />
          {points.map((point, index) => <circle key={index} cx={x(point.x)} cy={y(point.y)} r={3.5} fill={colors[point.seriesIndex]} fillOpacity={0.85} onPointerEnter={() => setSelected(index)} />)}
          <circle cx={x(point.x)} cy={y(point.y)} r={7} fill="none" stroke="var(--text)" strokeWidth={1.5} pointerEvents="none" />
        </svg>
        {ticks.map(tick => <span key={`y${tick}`} className="chart-y-tick" style={{ left: '0px', top: `${top + plotHeight - Math.round(plotHeight * tick / 4) - 8}px`, width: `${left - 8}px` }}>{axisNumber((ys.min + (ys.max - ys.min) * tick / 4) * ys.magnitude)}</span>)}
        {ticks.map(tick => <span key={`x${tick}`} className="chart-x-tick" style={{ left: `${left + Math.round(plotWidth * tick / 4) - 40}px`, top: `${top + plotHeight + 8}px`, width: '80px' }}>{axisNumber((xs.min + (xs.max - xs.min) * tick / 4) * xs.magnitude)}</span>)}
      </div>
    </div>
    <p className="chart-caption">{chart.xLabel || 'X'}{chart.xUnit ? ` · ${chart.xUnit}` : ''}</p>
    <p id={`${id}-selection`} className="chart-selection">{point.series} / {point.label}{t("：")}{chart.xLabel || 'X'} = {unitValue(point.x, chart.xUnit)}{t("，")}{chart.yLabel || 'Y'} = {unitValue(point.y, chart.unit)}</p>
  </>;
}

export function HeatmapPlot({ chart }: { chart: HeatmapChart }) {
  const [selected, setSelected] = useState({ row: 0, column: 0 });
  const id = useId();
  const numbers = chart.values.flat().filter((value): value is number => value !== null);
  const magnitude = Math.max(...numbers.map(Math.abs)) || 1;
  const min = Math.min(...numbers), max = Math.max(...numbers);
  const minimum = min / magnitude, maximum = max / magnitude;
  const band = (value: number) => maximum === minimum ? 2 : Math.min(4, Math.floor((value / magnitude - minimum) / (maximum - minimum) * 5));
  const left = 88, top = 28, cell = 24;
  const width = left + cell * chart.xLabels.length + 8, height = top + cell * chart.yLabels.length + 8;
  const row = Math.min(selected.row, chart.yLabels.length - 1), column = Math.min(selected.column, chart.xLabels.length - 1);
  return <>
    <p className="chart-caption">{t("col：")}{chart.xLabel || t("分类")} {t(" · row：")}{chart.yLabel || t("分类")}</p>
    <div className="chart-viewport" tabIndex={0} role="group" aria-label={t("热力图，方向键选择单元格，Home 和 End 跳到当前 row 首尾")} aria-describedby={`${id}-selection`} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = {
        row: Math.max(0, Math.min(chart.yLabels.length - 1, row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))),
        column: event.key === 'Home' ? 0 : event.key === 'End' ? chart.xLabels.length - 1 : Math.max(0, Math.min(chart.xLabels.length - 1, column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))),
      };
      setSelected(next);
      revealChartCell(event.currentTarget, left + next.column * cell, top + next.row * cell, cell, cell);
    }}>
      <div className="chart-plot" style={{ width: `${width}px`, height: `${height}px` }}>
        <svg width={`${width}px`} height={`${height}px`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs><pattern id={`${id}-missing`} width={5} height={5} patternUnits="userSpaceOnUse"><rect width={5} height={5} fill="var(--bg)" /><circle cx={1.5} cy={1.5} r={0.8} fill="var(--muted)" /></pattern></defs>
          {chart.values.flatMap((values, rowIndex) => values.map((value, columnIndex) => <rect key={`${rowIndex}:${columnIndex}`} x={left + columnIndex * cell} y={top + rowIndex * cell} width={cell - 2} height={cell - 2} rx={4} fill={value === null ? `url(#${id}-missing)` : `var(--heat-${band(value)})`} onPointerEnter={() => setSelected({ row: rowIndex, column: columnIndex })} />))}
          <rect x={left + column * cell - 1} y={top + row * cell - 1} width={cell} height={cell} rx={5} fill="none" stroke="var(--text)" strokeWidth={2} pointerEvents="none" />
        </svg>
        {chart.xLabels.map((label, index) => <span key={label} className="chart-x-tick" title={label} style={{ left: `${left + index * cell}px`, top: '4px', width: `${cell}px` }}>{index + 1}</span>)}
        {chart.yLabels.map((label, index) => <span key={label} className="chart-y-tick" title={label} style={{ left: '0px', top: `${top + index * cell + 4}px`, width: `${left - 8}px` }}>{shortLabel(label, left - 8)}</span>)}
      </div>
    </div>
    <div className="chart-legend"><span>{t("低") + " "}{axisNumber(min)}</span>{[0, 1, 2, 3, 4].map(index => <i key={index} className="chart-heat-key" style={{ background: `var(--heat-${index})` }} aria-hidden="true" />)}<span>{t("高") + " "}{axisNumber(max)}{chart.unit ? ` ${chart.unit}` : ''} {" " + t("· 点纹为缺失")}{min === max ? t(" · 数值全部相同") : ''}</span></div>
    <p className="chart-caption">{t("col 编号对应数据表顺序 · 五档等宽色阶 · 方向键或指针查看单元格")}</p>
    <p id={`${id}-selection`} className="chart-selection">{chart.yLabels[row]} / {chart.xLabels[column]}{t("：")}{unitValue(chart.values[row][column], chart.unit)}</p>
  </>;
}
