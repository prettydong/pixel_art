import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { CategoryChart, ScatterChart, HeatmapChart } from '@pixel/contracts/charts';
import { axisNumber, colors, shortLabel } from './chartGeometry';
import { revealChartCell, useChartViewport } from './useChartViewport';

const colorStyle = (index: number) => ({ '--series-color': colors[index] } as CSSProperties);
const unitValue = (value: number | null, unit?: string) => value === null ? '缺失' : `${value}${unit ? ` ${unit}` : ''}`;

export function PiePlot({ chart }: { chart: CategoryChart }) {
  const [selected, setSelected] = useState(0);
  const size = 160, center = 80, radius = 76;
  const values = chart.series[0].values;
  const largest = Math.max(...values.map(value => value ?? 0));
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0) / largest, 0);
  const proportions = values.map(value => (value ?? 0) / largest / total);
  let cumulative = 0;
  const ends = proportions.map(value => cumulative += value);
  const sliceAt = (x: number, y: number) => {
    const angle = (Math.atan2(y - center, x - center) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    const index = ends.findIndex(end => angle / (2 * Math.PI) < end);
    return index < 0 ? ends.length - 1 : index;
  };
  // Each horizontal run is one design pixel high. No arcs or scaled bitmap.
  const paths = useMemo(() => {
    const result = values.map(() => '');
    for (let y = center - radius; y < center + radius; y++) {
      let previous = -1, start = 0;
      for (let x = center - radius; x <= center + radius; x++) {
        const inside = (x + 0.5 - center) ** 2 + (y + 0.5 - center) ** 2 < radius ** 2;
        const index = inside ? sliceAt(x + 0.5, y + 0.5) : -1;
        if (index === previous) continue;
        if (previous >= 0) result[previous] += `M${start} ${y}h${x - start}v1h${start - x}z`;
        start = x; previous = index;
      }
    }
    return result;
  }, [chart]);
  return <div className="pixel-chart-pie">
    <svg width={`${size}rem`} height={`${size}rem`} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`${chart.title}；各分类数值和占比见旁边列表`}>
      {paths.map((path, index) => <path key={index} d={path} fill={colors[index]} onPointerEnter={() => setSelected(index)}><title>{chart.labels[index]}：{unitValue(values[index], chart.unit)}（{(proportions[index] * 100).toFixed(1)}%）</title></path>)}
    </svg>
    <div className="pixel-chart-pie-legend">{chart.labels.map((label, index) => <button key={label} type="button" className={selected === index ? 'is-selected' : ''} style={colorStyle(index)} onClick={() => setSelected(index)} onFocus={() => setSelected(index)} aria-pressed={selected === index}>
      <i aria-hidden="true" /><span>{index + 1}. {label}：{unitValue(values[index], chart.unit)} · {values[index] === null ? '无占比' : `${(proportions[index] * 100).toFixed(1)}%`}</span>
    </button>)}</div>
    <p className="pixel-chart-caption">{chart.series[0].name} · 占比按有效数值总和计算，缺失值不计入总和。</p>
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
  const points = chart.series.flatMap((series, seriesIndex) => series.points.map((point, index) => ({ ...point, series: series.name, seriesIndex, label: point.label || `点 ${index + 1}` })));
  const point = points[Math.min(selected, points.length - 1)];
  const width = Math.max(360, available), height = 208, left = 88, top = 12, plotWidth = width - left - 48, plotHeight = 160;
  const xs = numericScale(points.map(point => point.x)), ys = numericScale(points.map(point => point.y));
  const x = (value: number) => left + Math.round(xs.fraction(value) * plotWidth);
  const y = (value: number) => top + plotHeight - Math.round(ys.fraction(value) * plotHeight);
  const ticks = [0, 1, 2, 3, 4];
  return <>
    <div className="pixel-chart-legend">{chart.series.map((series, index) => <span key={series.name} style={colorStyle(index)}><i aria-hidden="true" />{index + 1}. {series.name}</span>)}</div>
    <p className="pixel-chart-caption">{chart.yLabel || 'Y'}{chart.unit ? ` · ${chart.unit}` : ''}</p>
    <div ref={viewport} className="pixel-chart-viewport" tabIndex={0} role="group" aria-label="散点图，左右方向键逐点查看，Home 和 End 跳到首尾" aria-describedby={`${id}-selection`} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)));
      setSelected(next);
      revealChartCell(event.currentTarget, x(points[next].x) - 8, y(points[next].y) - 8, 16, 16);
    }}>
      <div className="pixel-chart-plot" style={{ width: `${width}rem`, height: `${height}rem` }}>
        <svg width={`${width}rem`} height={`${height}rem`} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
          {ticks.map(tick => <g key={tick} fill="var(--chart-grid)"><rect x={left + Math.round(plotWidth * tick / 4)} y={top} width={1} height={plotHeight} /><rect x={left} y={top + plotHeight - Math.round(plotHeight * tick / 4)} width={plotWidth} height={1} /></g>)}
          <rect x={left} y={top} width={1} height={plotHeight + 1} fill="var(--muted)" /><rect x={left} y={top + plotHeight} width={plotWidth} height={1} fill="var(--muted)" />
          {points.map((point, index) => <rect key={index} x={x(point.x) - 2} y={y(point.y) - 2} width={5} height={5} fill={colors[point.seriesIndex]} onPointerEnter={() => setSelected(index)} />)}
          <path d={`M${x(point.x) - 4} ${y(point.y) - 4}h9v9h-9zM${x(point.x) - 3} ${y(point.y) - 3}h7v7h-7z`} fill="var(--text)" fillRule="evenodd" pointerEvents="none" />
        </svg>
        {ticks.map(tick => <span key={`y${tick}`} className="pixel-chart-y-tick" style={{ left: '0rem', top: `${top + plotHeight - Math.round(plotHeight * tick / 4) - 8}rem`, width: `${left - 8}rem` }}>{axisNumber((ys.min + (ys.max - ys.min) * tick / 4) * ys.magnitude)}</span>)}
        {ticks.map(tick => <span key={`x${tick}`} className="pixel-chart-x-tick" style={{ left: `${left + Math.round(plotWidth * tick / 4) - 40}rem`, top: `${top + plotHeight + 8}rem`, width: '80rem' }}>{axisNumber((xs.min + (xs.max - xs.min) * tick / 4) * xs.magnitude)}</span>)}
      </div>
    </div>
    <p className="pixel-chart-caption">{chart.xLabel || 'X'}{chart.xUnit ? ` · ${chart.xUnit}` : ''} · 数值坐标轴 · 方向键逐点查看</p>
    <p id={`${id}-selection`} className="pixel-chart-selection">{point.series} / {point.label}：{chart.xLabel || 'X'} = {unitValue(point.x, chart.xUnit)}，{chart.yLabel || 'Y'} = {unitValue(point.y, chart.unit)}</p>
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
    <p className="pixel-chart-caption">列：{chart.xLabel || '分类'} · 行：{chart.yLabel || '分类'}</p>
    <div className="pixel-chart-viewport" tabIndex={0} role="group" aria-label="热力图，方向键选择单元格，Home 和 End 跳到当前行首尾" aria-describedby={`${id}-selection`} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = {
        row: Math.max(0, Math.min(chart.yLabels.length - 1, row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))),
        column: event.key === 'Home' ? 0 : event.key === 'End' ? chart.xLabels.length - 1 : Math.max(0, Math.min(chart.xLabels.length - 1, column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))),
      };
      setSelected(next);
      revealChartCell(event.currentTarget, left + next.column * cell, top + next.row * cell, cell, cell);
    }}>
      <div className="pixel-chart-plot" style={{ width: `${width}rem`, height: `${height}rem` }}>
        <svg width={`${width}rem`} height={`${height}rem`} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
          <defs><pattern id={`${id}-missing`} width={4} height={4} patternUnits="userSpaceOnUse"><rect width={4} height={4} fill="var(--panel)" /><rect width={1} height={1} fill="var(--muted)" /></pattern></defs>
          {chart.values.flatMap((values, rowIndex) => values.map((value, columnIndex) => <rect key={`${rowIndex}:${columnIndex}`} x={left + columnIndex * cell} y={top + rowIndex * cell} width={cell - 1} height={cell - 1} fill={value === null ? `url(#${id}-missing)` : `var(--heat-${band(value)})`} onPointerEnter={() => setSelected({ row: rowIndex, column: columnIndex })} />))}
          <path d={`M${left + column * cell} ${top + row * cell}h23v23h-23zM${left + column * cell + 1} ${top + row * cell + 1}h21v21h-21z`} fill="var(--text)" fillRule="evenodd" pointerEvents="none" />
        </svg>
        {chart.xLabels.map((label, index) => <span key={label} className="pixel-chart-x-tick" title={label} style={{ left: `${left + index * cell}rem`, top: '4rem', width: `${cell}rem` }}>{index + 1}</span>)}
        {chart.yLabels.map((label, index) => <span key={label} className="pixel-chart-y-tick" title={label} style={{ left: '0rem', top: `${top + index * cell + 4}rem`, width: `${left - 8}rem` }}>{shortLabel(label, left - 8)}</span>)}
      </div>
    </div>
    <div className="pixel-chart-legend"><span>低 {axisNumber(min)}</span>{[0, 1, 2, 3, 4].map(index => <i key={index} className="pixel-chart-heat-key" style={{ background: `var(--heat-${index})` }} aria-hidden="true" />)}<span>高 {axisNumber(max)}{chart.unit ? ` ${chart.unit}` : ''} · 点纹为缺失{min === max ? ' · 数值全部相同' : ''}</span></div>
    <p className="pixel-chart-caption">列号对应数据表顺序 · 五档等宽色阶 · 方向键或指针查看单元格</p>
    <p id={`${id}-selection`} className="pixel-chart-selection">{chart.yLabels[row]} / {chart.xLabels[column]}：{unitValue(chart.values[row][column], chart.unit)}</p>
  </>;
}
