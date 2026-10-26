import { getLanguage, t } from './i18n';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Mention } from '@pixel/contracts';
import { architectureColumns } from './architectureTemplates';
import { ArchitectureCells, ArchitectureHeaders } from './ArchitectureColumns';
import { mentionKey } from './mentionText';
import { Chip, Wafer } from './Icons';
import './Mentions.css';

type ArchitectureMention = Extract<Mention, { kind: 'architecture' }>;
type WaferMention = Extract<Mention, { kind: 'wafer' }>;
type Column = { label: string; optional?: boolean };

export function MentionIcon({ kind }: { kind: Mention['kind'] }) {
  return kind === 'architecture' ? <Chip /> : <Wafer />;
}

const groups: { kind: Mention['kind']; label: () => string; columns: () => Column[] }[] = [
  { kind: 'architecture', label: () => t("架构"), columns: () => [{ label: t("备用 row") }, { label: t("每组备用 col"), optional: true }, { label: 'Segment', optional: true }, { label: 'Row × Col', optional: true }] },
  { kind: 'wafer', label: () => 'Wafer', columns: () => [{ label: t("产品"), optional: true }, { label: 'Chip × Region', optional: true }, { label: t("总 fail") }] },
];

function pickerCells(mention: Mention): (string | number | undefined)[] {
  const language = getLanguage();
  if (mention.kind === 'wafer') return [mention.productName, `${mention.chipCount.toLocaleString(language)} × ${mention.regionCount.toLocaleString(language)}`, mention.failCount.toLocaleString(language)];
  const value = architectureColumns(mention.description);
  return [value?.spareRows, value?.ccrCols, value?.segments, value ? `${value.rows.toLocaleString(language)} × ${value.cols.toLocaleString(language)}` : undefined];
}

type PickerProps = { id: string; options: Mention[]; matches: Mention[]; loading: boolean; error: string; activeIndex: number; onActive: (index: number) => void; onPick: (mention: Mention) => void };

/** The "@" list above the composer: the task's architectures and wafers, one compact row each. */
export function MentionPicker({ id, options, matches, loading, error, activeIndex, onActive, onPick }: PickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Scroll only the list: scrollIntoView would also move the clipped workspace around it.
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !option) return;
    const top = option.offsetTop, bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [activeIndex, matches.length]);
  // Keep focus in the composer so typing continues to narrow the list.
  return <div className="mention-picker" ref={listRef} id={id} role="listbox" aria-label={t("引用架构或 wafer")} aria-busy={loading} onMouseDown={event => event.preventDefault()}>
    {error ? <p className="mention-picker-note error-text" role="alert">{error}</p>
      : !matches.length ? <p className="mention-picker-note" role="status">{loading ? t("正在读取架构和 wafer…") : options.length ? t("没有匹配的架构或 wafer") : t("本任务还没有架构或 wafer")}</p>
      : groups.map(group => {
        const items = matches.filter(mention => mention.kind === group.kind);
        if (!items.length) return null;
        const columns = group.columns();
        return <div key={group.kind} role="group" aria-label={group.label()} className="mention-group" style={{ '--mention-columns': columns.length } as CSSProperties}>
          <div className="mention-head" aria-hidden="true"><span>{group.label()}</span>{columns.map(column => <span key={column.label} className={column.optional ? 'mention-optional' : undefined}>{column.label}</span>)}</div>
          {items.map(item => {
            const index = matches.indexOf(item);
            return <div key={mentionKey(item)} id={`${id}-${index}`} role="option" aria-selected={index === activeIndex} className="mention-option" onMouseMove={() => { if (index !== activeIndex) onActive(index); }} onClick={() => onPick(item)}>
              <span className="mention-name"><MentionIcon kind={item.kind} /><span title={item.name}>{item.name}</span></span>
              {pickerCells(item).map((cell, column) => <span key={column} className={columns[column].optional ? 'mention-optional' : undefined}>{cell ?? '–'}</span>)}
            </div>;
          })}
        </div>;
      })}
  </div>;
}

/** Tables of what a sent message referenced, as it was when the message was sent. */
export function MentionTables({ mentions }: { mentions: Mention[] }) {
  const language = getLanguage();
  const architectures = mentions.filter((mention): mention is ArchitectureMention => mention.kind === 'architecture');
  const wafers = mentions.filter((mention): mention is WaferMention => mention.kind === 'wafer');
  const number = (value: number) => value.toLocaleString(language);
  return <div className="message-mentions" role="group" aria-label={t("引用的架构和 wafer")}>
    {architectures.length > 0 && <div className="sheet-frame"><table className="sheet">
      <thead><tr><th scope="col">{t("架构")} ({architectures.length})</th><ArchitectureHeaders region /></tr></thead>
      <tbody>{architectures.map(architecture => <tr key={architecture.id}>
        <th scope="row" title={t("版本 {0}", architecture.fingerprint.slice(0, 8))}><span className="mention-name"><Chip /><span>{architecture.name}</span></span></th>
        <ArchitectureCells description={architecture.description} region />
      </tr>)}</tbody>
    </table></div>}
    {wafers.length > 0 && <div className="sheet-frame"><table className="sheet">
      <thead><tr>
        <th scope="col">Wafer ({wafers.length})</th><th scope="col" className="sheet-optional">{t("产品")}</th><th scope="col">{t("来源")}</th>
        <th scope="col" className="sheet-num sheet-optional">Chip × Region</th><th scope="col" className="sheet-num sheet-optional">Row × Col</th>
        <th scope="col" className="sheet-num">{t("总 fail")}</th><th scope="col" className="sheet-num sheet-optional">{t("有 fail 的 region")}</th>
      </tr></thead>
      <tbody>{wafers.map(wafer => {
        const regions = wafer.chipCount * wafer.regionCount;
        return <tr key={wafer.id}>
          <th scope="row"><span className="mention-name"><Wafer /><span>{wafer.name}</span></span></th>
          <td className="sheet-optional">{wafer.productName}</td>
          <td>{wafer.synthetic ? <span className="data-badge data-badge-warn">{t("合成")}</span> : <span className="sheet-muted">{t("导入")}</span>}</td>
          <td className="sheet-num sheet-muted sheet-optional">{number(wafer.chipCount)} × {number(wafer.regionCount)}</td>
          <td className="sheet-num sheet-muted sheet-optional">{number(wafer.rows)} × {number(wafer.cols)}</td>
          <td className="sheet-num">{number(wafer.failCount)}</td>
          <td className="sheet-num sheet-muted sheet-optional">{number(wafer.occupiedRegionCount)} / {number(regions)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </div>;
}
