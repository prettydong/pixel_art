import { t } from './i18n';
import { useMemo, useState } from 'react';
import { ccrDefinition, ccrSegmentRows, type CcrDefinition } from './architectureTemplates';
import './CcrLayoutPreview.css';

// Design-pixel width of the row map; one segment needs at least one design pixel.
const MAP_WIDTH = 256;
// Subgroups are labelled individually up to this count; larger counts use a plain strip.
const LABELLED_GROUPS = 16;

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
  const groups = device.ccr_groups_per_segment;
  const segment = boundedInteger(segmentInput, 0, count - 1);
  const column = boundedInteger(columnInput ?? String(base), base, array.cols - 1 + base);
  const range = segment === null ? null : ccrSegmentRows(value, segment);
  const group = column === null ? null : (column - base) % groups;
  const firstSegment = Math.max(0, Math.min(segment ?? 0, count - Math.min(count, 3)));
  const ranges = useMemo(() => count > MAP_WIDTH ? null : Array.from({ length: count }, (_, id) => ccrSegmentRows(value, id)), [value, count]);

  return <section className="ccr-layout" aria-label={t("CCR 结构预览")}>
    <p className="ccr-layout-heading">{t("Region {0} row × {1} col · {2} 个 segment", array.rows, array.cols, count)}</p>
    <div className="ccr-row-pool">
      <i className="ccr-swatch ccr-swatch-pool" aria-hidden="true" />
      <p>{t("Region 全局备用 row：{0} 条，由全部 {1} 个 segment 共享", device.spare_rows, count)}</p>
    </div>
    {ranges ? <RowMap ranges={ranges} rows={array.rows} base={base} selected={segment} onSelect={id => setSegmentInput(String(id))} />
      : <p className="task-note">{t("超过 {0} 个 segment 时不绘制 row 分布图。", MAP_WIDTH)}</p>}
    <div className="ccr-layout-controls">
      <label><span className="ccr-control-label">{t("Segment 编号（0～")}{count - 1}{t("）")}</span>
        <input inputMode="numeric" value={segmentInput} onChange={event => setSegmentInput(event.target.value)} />
      </label>
      <label><span className="ccr-control-label">{t("col 地址（")}{base}{t("～")}{array.cols - 1 + base}{t("）")}</span>
        <input inputMode="numeric" value={columnInput ?? String(base)} onChange={event => setColumnInput(event.target.value)} />
      </label>
    </div>
    {segment === null || column === null || group === null ? <p className="error-text" role="status">{t("请输入范围内的整数以查看映射。")}</p> : <>
      <div className="ccr-segments" aria-label={t("相邻 segment row 范围")}>
        {Array.from({ length: Math.min(count, 3) }, (_, index) => {
          const id = firstSegment + index;
          const [start, end] = ccrSegmentRows(value, id);
          return <button type="button" key={id} aria-pressed={id === segment} onClick={() => setSegmentInput(String(id))}>
            <span>Segment {id}</span>
            <span>{start === end ? t("无映射 row") : t("row {0}～{1}", start + base, end - 1 + base)}</span>
            <span>{t("独立 CCR · {0} 个子组", groups)}</span>
          </button>;
        })}
      </div>
      <div className="ccr-column-pool" aria-live="polite">
        <p>{t("Segment {0} · col {1} → 子组 {2} · 该子组备用 col：{3} 条", segment, column, group, device.ccr_spares_per_group[group])}</p>
        <GroupStrip capacities={device.ccr_spares_per_group} selected={group} />
        <ColumnStrip cols={array.cols} base={base} groups={groups} column={column} group={group} />
        <p className="task-note">{range && range[0] < range[1]
          ? t("一次 col 修复覆盖：Segment {0} 内第 {1} col，row {2}～{3}。", segment, column, range[0] + base, range[1] - 1 + base)
          : t("Segment {0} 没有映射 row。", segment)}</p>
      </div>
    </>}
  </section>;
}

/** Each band spans its exact computed row interval; nothing is divided evenly. */
function RowMap({ ranges, rows, base, selected, onSelect }: { ranges: [number, number][]; rows: number; base: number; selected: number | null; onSelect: (id: number) => void }) {
  const x = (row: number) => Math.round(row / rows * MAP_WIDTH);
  return <figure className="ccr-map">
    <figcaption>{t("Segment row 分布")}</figcaption>
    <svg width={`${MAP_WIDTH + 2}rem`} height="18rem" viewBox={`0 0 ${MAP_WIDTH + 2} 18`} shapeRendering="crispEdges" role="img"
      aria-label={t("Region 内 {0} 个 segment 的 row 分布，Segment {1} 高亮", ranges.length, selected ?? '—')}>
      <rect x="0" y="0" width={MAP_WIDTH + 2} height="18" fill="var(--line)" />
      {ranges.map(([start, end], id) => {
        const left = x(start); const width = x(end) - left;
        if (width <= 0) return null;
        const fill = id === selected ? 'var(--architecture-accent)' : id % 2 ? 'var(--architecture-surface)' : 'var(--diagram-cell)';
        return <rect key={id} className="ccr-map-band" x={left + 1} y="1" width={width} height="16" fill={fill} onClick={() => onSelect(id)}>
          <title>{t("Segment {0} · row {1}～{2}", id, start + base, end - 1 + base)}</title>
        </rect>;
      })}
    </svg>
    <div className="ccr-map-axis" style={{ width: `${MAP_WIDTH + 2}rem` }}><span>row {base}</span><span>row {rows - 1 + base}</span></div>
    <div className="ccr-legend">
      <span><i className="ccr-swatch ccr-swatch-selected" aria-hidden="true" />{t("所选 segment")}</span>
      <span><i className="ccr-swatch ccr-swatch-other" aria-hidden="true" />{t("其他 segment（交替着色）")}</span>
    </div>
  </figure>;
}

function GroupStrip({ capacities, selected }: { capacities: number[]; selected: number }) {
  if (capacities.length > LABELLED_GROUPS) {
    const cell = Math.max(1, Math.floor(MAP_WIDTH / capacities.length));
    return <figure className="ccr-map">
      <figcaption>{t("CCR 子组与备用 col 容量")}</figcaption>
      <svg width={`${cell * capacities.length}rem`} height="12rem" viewBox={`0 0 ${cell * capacities.length} 12`} shapeRendering="crispEdges" role="img"
        aria-label={t("{0} 个 CCR 子组，子组 {1} 高亮", capacities.length, selected)}>
        {capacities.map((capacity, index) => <rect key={index} x={index * cell} y="0" width={cell} height="12"
          fill={index === selected ? 'var(--architecture-accent)' : index % 2 ? 'var(--architecture-surface)' : 'var(--diagram-cell)'}>
          <title>{t("子组 {0}：{1} 条备用 col", index, capacity)}</title>
        </rect>)}
      </svg>
    </figure>;
  }
  return <figure className="ccr-map">
    <figcaption>{t("CCR 子组与备用 col 容量")}</figcaption>
    <ol className="ccr-groups">
      {capacities.map((capacity, index) => <li key={index} className={index === selected ? 'selected' : ''} aria-current={index === selected ? 'true' : undefined}
        title={t("子组 {0}：{1} 条备用 col", index, capacity)}>
        <span>G{index}</span><span>{capacity}</span>
      </li>)}
    </ol>
  </figure>;
}

/** A window of real column addresses; highlighted columns share the selected column's subgroup. */
function ColumnStrip({ cols, base, groups, column, group }: { cols: number; base: number; groups: number; column: number; group: number }) {
  const size = Math.min(cols, 64);
  const offset = column - base;
  const centered = Math.max(0, Math.min(cols - size, offset - Math.floor(size / 2)));
  const start = Math.max(0, Math.min(cols - size, Math.floor(centered / groups) * groups));
  const cell = 4;
  return <figure className="ccr-map">
    <figcaption>{t("col {0}～{1}：高亮列与 col {2} 同属子组 {3}", start + base, start + size - 1 + base, column, group)}</figcaption>
    <svg width={`${size * cell + 2}rem`} height="14rem" viewBox={`0 0 ${size * cell + 2} 14`} shapeRendering="crispEdges" role="img"
      aria-label={t("col {0}～{1}：高亮列与 col {2} 同属子组 {3}", start + base, start + size - 1 + base, column, group)}>
      <rect x="0" y="0" width={size * cell + 2} height="14" fill="var(--line)" />
      {Array.from({ length: size }, (_, index) => {
        const address = start + index;
        const member = address % groups === group;
        return <rect key={address} x={1 + index * cell} y={address === offset ? 1 : 3} width={cell - 1} height={address === offset ? 12 : 8}
          fill={address === offset ? 'var(--text)' : member ? 'var(--architecture-accent)' : 'var(--panel)'} />;
      })}
    </svg>
    <div className="ccr-legend">
      <span><i className="ccr-swatch ccr-swatch-column" aria-hidden="true" />col {column}</span>
      <span><i className="ccr-swatch ccr-swatch-selected" aria-hidden="true" />{t("同一子组")}</span>
      <span><i className="ccr-swatch ccr-swatch-empty" aria-hidden="true" />{t("其他子组")}</span>
    </div>
  </figure>;
}

function boundedInteger(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
