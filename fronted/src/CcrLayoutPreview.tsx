import { useMemo, useState } from 'react';
import { ccrDefinition, ccrSegmentRows, type CcrDefinition } from './architectureTemplates';
import './CcrLayoutPreview.css';

export function CcrLayoutPreview({ description }: { description: string }) {
  const value = useMemo(() => ccrDefinition(description), [description]);
  return value ? <Layout value={value} /> : null;
}

function Layout({ value }: { value: CcrDefinition }) {
  const [segmentInput, setSegmentInput] = useState('0');
  const [columnInput, setColumnInput] = useState<string | null>(null);
  const { array, device } = value;
  const base = array.coordinate_base;
  const count = device.row_layout.section_count / device.row_layout.sections_per_segment;
  const segment = boundedInteger(segmentInput, 0, count - 1);
  const column = boundedInteger(columnInput ?? String(base), base, array.cols - 1 + base);
  const range = segment === null ? null : ccrSegmentRows(value, segment);
  const group = column === null ? null : (column - base) % device.ccr_groups_per_segment;
  const firstSegment = Math.max(0, Math.min(segment ?? 0, count - Math.min(count, 3)));

  return <section className="ccr-layout" aria-label="CCR 结构预览">
    <p className="ccr-layout-heading">Region · {array.rows} row × {array.cols} col · {count} 个 segment</p>
    <div className="ccr-row-pool">
      <p>Region 全局备用 row · {device.spare_rows} 条</p>
    </div>
    <div className="ccr-layout-controls">
      <label><span className="ccr-control-label">Segment 编号（0～{count - 1}）</span>
        <input inputMode="numeric" value={segmentInput} onChange={event => setSegmentInput(event.target.value)} />
      </label>
      <label><span className="ccr-control-label">col 地址（{base}～{array.cols - 1 + base}）</span>
        <input inputMode="numeric" value={columnInput ?? String(base)} onChange={event => setColumnInput(event.target.value)} />
      </label>
    </div>
    {segment === null || column === null || group === null ? <p className="error-text" role="status">请输入范围内的整数以查看映射。</p> : <>
      <div className="ccr-segments" aria-label="相邻 segment row 范围">
        {Array.from({ length: Math.min(count, 3) }, (_, index) => {
          const id = firstSegment + index;
          const [start, end] = ccrSegmentRows(value, id);
          return <button type="button" key={id} aria-pressed={id === segment} onClick={() => setSegmentInput(String(id))}>
            <span>Segment {id}</span>
            <span>{start === end ? '无映射 row' : `row ${start + base}～${end - 1 + base}`}</span>
            <span>独立 CCR · {device.ccr_groups_per_segment} 子组</span>
          </button>;
        })}
      </div>
      <div className="ccr-column-pool" aria-live="polite">
        <p>Segment {segment} · col {column} → 子组 {group} · 备用 col 容量 {device.ccr_spares_per_group[group]} 条</p>
        <p className="task-note">{range && range[0] < range[1]
          ? `一次 col 修复覆盖：Segment ${segment} 内第 ${column} col，row ${range[0] + base}～${range[1] - 1 + base}。`
          : `Segment ${segment} 没有映射 row。`}</p>
      </div>
    </>}
  </section>;
}

function boundedInteger(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
