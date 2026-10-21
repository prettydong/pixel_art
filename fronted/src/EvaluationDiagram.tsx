import { useId } from 'react';
import { t } from './i18n';
import './EvaluationDiagram.css';

type DiagramKind = 'data' | 'architecture' | 'repair';
type Point = [number, number];

const descriptions: Record<DiagramKind, string> = {
  get data() { return t("失效分布示意：wafer 上标出失效 die，右侧为失效分布柱形与累计曲线。"); },
  get architecture() { return t("CCR 架构示意：一个 Region 内包含多个 Segment，各 Segment 右侧为独立 CCR col 资源；Region 下方为所有 Segment 共享的全局备用 row 池，默认 128 条。示意不按实际数量或比例绘制。"); },
  get repair() { return t("修补示意：含失效单元的 row 映射至 Region 共享的全局备用 row，同列失效由 Segment 内 CCR col 覆盖，圆环表示修补后良率。"); },
};

// Catmull-Rom through the points, written as cubic Béziers.
function smoothPath(points: Point[]) {
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point[0]} ${point[1]}`;
    const [p0, p1, p2, p3] = [points[index - 2] ?? points[index - 1], points[index - 1], point, points[index + 1] ?? point];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    return `${path} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }, '');
}

// Illustrative geometry only: these pictures introduce the entry points and are not evaluation results.
const WAFER = { cx: 62, cy: 66, r: 52 };
const dies = Array.from({ length: 81 }, (_, index) => {
  const col = index % 9 - 4, row = Math.floor(index / 9) - 4;
  const x = WAFER.cx + col * 10 - 4, y = WAFER.cy + row * 10 - 4;
  if (Math.hypot(Math.abs(col * 10) + 4, Math.abs(row * 10) + 4) > WAFER.r - 4) return null;
  const cluster = Math.exp(-((col - 2) ** 2 + (row + 2) ** 2) / 2.6);
  const scattered = [[-3, 1], [-1, 3], [1, 2]].some(([c, r]) => c === col && r === row) ? 0.3 : 0;
  const heat = Math.max(cluster, scattered);
  const level = heat > 0.75 ? 4 : heat > 0.45 ? 3 : heat > 0.25 ? 2 : heat > 0.12 ? 1 : 0;
  return { x, y, level, delay: (col + row + 8) * 35 };
}).filter(die => die !== null);

const BASE = 108;
const counts = [70, 50, 34, 24, 16, 11, 7, 4];
const total = counts.reduce((sum, value) => sum + value, 0);
const bars = counts.map((value, index) => ({ x: 132 + index * 12, height: value }));
const cumulative = counts.map((_, index): Point => [136 + index * 12, Math.round(BASE - 82 * counts.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / total)]);

const segments = [18, 46, 74];
const spareRows = [30, 41, 52, 63, 74];
const yieldArc = 0.92;
const RING = 2 * Math.PI * 13;

export function EvaluationDiagram({ kind }: { kind: DiagramKind }) {
  const id = useId().replace(/[^\w-]/g, '');
  return (
    <svg className={`evaluation-diagram diagram-${kind}`} viewBox="0 0 240 132" role="img" aria-label={descriptions[kind]}>
      {kind === 'data' && <>
        <defs>
          <clipPath id={`${id}-wafer`}><circle cx={WAFER.cx} cy={WAFER.cy} r={WAFER.r} /></clipPath>
          <linearGradient id={`${id}-scan`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="dg-stop" stopOpacity="0" />
            <stop offset=".8" className="dg-stop" stopOpacity=".28" />
            <stop offset="1" className="dg-stop" stopOpacity=".7" />
          </linearGradient>
        </defs>
        <circle className="dg-disk" cx={WAFER.cx} cy={WAFER.cy} r={WAFER.r} />
        <path className="dg-notch" d={`M${WAFER.cx - 5} ${WAFER.cy + WAFER.r + 1} a5 5 0 0 1 10 0z`} />
        {dies.map(die => <rect key={`${die.x}:${die.y}`} className={`dg-die dg-heat-${die.level}`} x={die.x} y={die.y} width="8" height="8" rx="2" style={{ animationDelay: `${die.delay}ms` }} />)}
        <g clipPath={`url(#${id}-wafer)`}><rect className="dg-scan" x={WAFER.cx - WAFER.r} y={WAFER.cy - WAFER.r - 22} width={WAFER.r * 2} height="22" fill={`url(#${id}-scan)`} /></g>
        <path className="dg-axis" d={`M128 ${BASE}H230`} />
        {[34, 60, 86].map(y => <path key={y} className="dg-grid" d={`M128 ${y}H230`} />)}
        {bars.map((bar, index) => <rect key={index} className={`dg-bar ${index === 0 ? 'dg-bar-hot' : ''}`} x={bar.x} y={BASE - bar.height} width="8" height={bar.height} rx="2.5" style={{ animationDelay: `${120 + index * 50}ms` }} />)}
        <path className="dg-trend" d={smoothPath(cumulative)} />
        {cumulative.map(([x, y], index) => <circle key={index} className="dg-marker" cx={x} cy={y} r="2.2" style={{ animationDelay: `${520 + index * 45}ms` }} />)}
      </>}
      {kind === 'architecture' && <>
        <rect className="dg-region" x="12" y="8" width="216" height="116" rx="11" />
        <path className="dg-rail" d={`M19 ${segments[0] + 12}V111${segments.map(y => `M19 ${y + 12}H26`).join('')}M19 111H26`} />
        {segments.map((y, segment) => <g key={y} className="dg-segment" style={{ animationDelay: `${segment * 90}ms` }}>
          <rect className="dg-segment-frame" x="26" y={y} width="194" height="24" rx="6" />
          {Array.from({ length: 32 }, (_, cell) => <rect key={cell} className="dg-cell" x={32 + (cell % 16) * 8} y={y + 5 + Math.floor(cell / 16) * 8} width="6" height="6" rx="1.5" />)}
          <path className="dg-divider" d={`M164 ${y + 4}V${y + 20}`} />
          {[0, 1, 2].map(group => <g key={group} className="dg-ccr" style={{ animationDelay: `${segment * 160 + group * 220}ms` }}>
            <rect x={171 + group * 15} y={y + 4} width="4" height="16" rx="2" />
            <rect x={177 + group * 15} y={y + 4} width="4" height="16" rx="2" />
          </g>)}
        </g>)}
        <rect className="dg-pool" x="26" y="104" width="194" height="14" rx="6" />
        {[107, 110.5, 114].map((y, index) => <rect key={y} className="dg-spare" x="32" y={y} width="182" height="2" rx="1" style={{ animationDelay: `${index * 180}ms` }} />)}
      </>}
      {kind === 'repair' && <>
        <rect className="dg-band dg-band-row" x="13" y="45" width="78" height="14" rx="5" />
        <rect className="dg-band dg-band-col" x="61" y="69" width="16" height="28" rx="5" />
        {Array.from({ length: 36 }, (_, index) => {
          const col = index % 6, row = Math.floor(index / 6);
          const failed = (row === 2 && col === 3) || (row === 4 && col === 4);
          return <rect key={index} className={failed ? 'dg-fail' : 'dg-cell'} x={16 + col * 12} y={24 + row * 12} width="10" height="10" rx="2.5" />;
        })}
        <path className="dg-link" d="M69 100V112" />
        <rect className="dg-ccr-used" x="59" y="115" width="20" height="5" rx="2.5" />
        <path className="dg-flow" d="M93 52C118 52 120 34 142 34" />
        <path className="dg-arrowhead" d="M137 30l5 4-5 4" />
        {spareRows.map((y, index) => <rect key={y} className={index === 0 ? 'dg-spare-used' : 'dg-spare-free'} x="148" y={y} width="76" height="7" rx="3.5" />)}
        <circle className="dg-ring" cx="186" cy="104" r="13" />
        <circle className="dg-ring-value" cx="186" cy="104" r="13" strokeDasharray={`${(RING * yieldArc).toFixed(1)} ${RING.toFixed(1)}`} transform="rotate(-90 186 104)" />
        <path className="dg-check" d="M180.5 104.5l3.6 3.4 7-7.4" />
      </>}
    </svg>
  );
}
