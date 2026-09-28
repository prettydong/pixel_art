import { useEffect, useMemo, useRef, useState } from 'react';
import type { DecodedWafer } from '@pixel/contracts/wafer-data';
import { createWaferMap, MAX_MAP_CHIPS } from '@pixel/contracts/wafer-spatial';
import { getPixelUnit } from './pixelGrid';

type Props = { decoded: DecodedWafer; selected: number; onSelect: (chip: number) => void };
type Band = { low: number; high: number; color: number };
export function WaferHeatmap({ decoded, selected, onSelect }: Props) {
  const [scale, setScale] = useState<'linear' | 'log'>('log');
  const [hovered, setHovered] = useState<number | null>(null);
  const [available, setAvailable] = useState(280);
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const counts = useMemo(() => {
    const values = new Uint32Array(decoded.layout.chipCount);
    for (const group of decoded.groups) values[Math.floor(group.regionIndex / decoded.layout.regionCount)] += group.positions.length;
    return values;
  }, [decoded]);
  const geometry = useMemo(() => decoded.layout.chipCount <= MAX_MAP_CHIPS ? createWaferMap(decoded.layout.chipCount) : null, [decoded.layout.chipCount]);
  const statistics = useMemo(() => {
    let total = 0; let zero = 0; let maximum = 0;
    for (const value of counts) { total += value; zero += Number(value === 0); maximum = Math.max(maximum, value); }
    return { total, zero, maximum };
  }, [counts]);
  const bands = useMemo(() => {
    const result: Band[] = []; let previous = 0;
    for (let index = 1; index <= 5; index++) {
      const high = index === 5 ? statistics.maximum : Math.floor(scale === 'log' ? Math.expm1(Math.log1p(statistics.maximum) * index / 5) : statistics.maximum * index / 5);
      if (high <= previous) continue;
      result.push({ low: previous + 1, high, color: index }); previous = high;
    }
    return result;
  }, [statistics.maximum, scale]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setAvailable(Math.max(1, Math.floor(node.clientWidth / getPixelUnit())));
    const observer = new ResizeObserver(update); observer.observe(node);
    window.addEventListener('resize', update); update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => { setHovered(null); }, [decoded]);
  const pitch = geometry ? Math.max(2, Math.min(8, Math.floor(Math.min(320, available) / Math.max(geometry.width, geometry.height)))) : 2;
  const active = hovered ?? selected;
  const cell = geometry?.cells[active];
  const color = (value: number) => value === 0 ? 0 : bands.find(band => value <= band.high)?.color ?? 5;
  function move(event: React.KeyboardEvent<SVGRectElement>, chip: number) {
    if (!geometry) return;
    let target = chip;
    if (event.key === 'ArrowLeft') target = Math.max(0, chip - 1);
    else if (event.key === 'ArrowRight') target = Math.min(counts.length - 1, chip + 1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = counts.length - 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const origin = geometry.cells[chip];
      const row = origin.y + (event.key === 'ArrowUp' ? -1 : 1);
      const candidates = geometry.cells.filter(item => item.y === row);
      if (candidates.length) target = candidates.reduce((best, item) => Math.abs(item.x - origin.x) < Math.abs(best.x - origin.x) ? item : best).chip;
    } else if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); onSelect(target); setHovered(null);
    svg.current?.querySelector<SVGRectElement>(`[data-chip="${target}"]`)?.focus();
  }
  return <section className="wafer-heatmap" aria-label="整片 wafer 热力图">
    <div className="wafer-heatmap-heading"><h3>Wafer 热力图（示意）</h3><label>色阶<select value={scale} onChange={event => setScale(event.target.value as 'linear' | 'log')}><option value="log">对数</option><option value="linear">线性</option></select></label><span>fail / chip</span></div>
    <div className="wafer-summary"><span>总 fail {statistics.total.toLocaleString()}</span><span>零 fail chip {statistics.zero.toLocaleString()} / {counts.length.toLocaleString()}</span><span>最大 {statistics.maximum.toLocaleString()} fail / chip</span></div>
    <div className="wafer-map-layout">
      <div ref={container} className="wafer-disk-scroll">{geometry ? <svg ref={svg} width={`${geometry.width * pitch}rem`} height={`${geometry.height * pitch}rem`} viewBox={`0 0 ${geometry.width * pitch} ${geometry.height * pitch}`} role="group" aria-label="圆盘内 chip 网格，点击或用方向键选择 chip" shapeRendering="crispEdges">
        {geometry.cells.map(item => {
          const x = item.x * pitch; const y = item.y * pitch; const size = pitch - 1;
          return <g key={item.chip}>
            <rect role="button" aria-pressed={selected === item.chip} aria-label={`Chip ${item.chip}，${counts[item.chip]} fail`} data-chip={item.chip} tabIndex={selected === item.chip ? 0 : -1} x={x} y={y} width={size} height={size} fill={`var(--wafer-${color(counts[item.chip])})`} onClick={() => { onSelect(item.chip); setHovered(null); }} onFocus={() => setHovered(item.chip)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(item.chip)} onMouseLeave={() => setHovered(null)} onKeyDown={event => move(event, item.chip)}>
              <title>{`Chip ${item.chip} · 网格 (${item.x}, ${item.y}) · ${counts[item.chip]} fail`}</title>
            </rect>
            {selected === item.chip && <path pointerEvents="none" fill="var(--text)" d={`M${x} ${y}h${size}v1h-${size}z M${x} ${y + size - 1}h${size}v1h-${size}z M${x} ${y}h1v${size}h-1z M${x + size - 1} ${y}h1v${size}h-1z`} />}
          </g>;
        })}
      </svg> : <p>圆盘预览上限：{MAX_MAP_CHIPS.toLocaleString()} chip</p>}</div>
      <div className="wafer-map-key"><div className="wafer-legend" aria-label="fail 数量图例"><span><i style={{ background: 'var(--wafer-0)' }} />0</span>{bands.map(band => <span key={band.color}><i style={{ background: `var(--wafer-${band.color})` }} />{band.low === band.high ? band.low.toLocaleString() : `${band.low.toLocaleString()}–${band.high.toLocaleString()}`}</span>)}</div>
        <p role="status">Chip {active.toLocaleString()}{cell ? ` · 网格 (${cell.x}, ${cell.y})` : ''}<br />{(counts[active] ?? 0).toLocaleString()} fail · {decoded.layout.regionCount} regions</p>
      </div>
    </div>
  </section>;
}
