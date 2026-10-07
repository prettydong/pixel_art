import { t } from './i18n';
export type ArchitectureFields = {
  rows: string;
  cols: string;
  coordinateBase: string;
  spareRows: string;
  ccrGroupsPerSegment: string;
  ccrSparesPerGroup: string;
  sectionCount: string;
  sectionsPerSegment: string;
  sectionGroupSize: string;
  subsectionSize: string;
  subsectionsPerGroup: string;
  notes: string;
};

const baseline: ArchitectureFields = {
  rows: '32768', cols: '2048', coordinateBase: '0', spareRows: '128',
  ccrGroupsPerSegment: '8', ccrSparesPerGroup: '2',
  sectionCount: '96', sectionsPerSegment: '2', sectionGroupSize: '2048',
  subsectionSize: '344', subsectionsPerGroup: '6', notes: '',
};

export const ARCHITECTURE_TEMPLATES: readonly {
  id: string; label: string; name: string; summary: string; fields: ArchitectureFields;
}[] = [
  {
    id: 'ccr-segmented', get label() { return t("CCR · 分段"); }, name: '32768×2048 CCR',
    get summary() { return t("48 个 segment；每 segment 8 个 CCR 子组，每组 2 条备用 col，Region 默认共享 128 条全局备用 row。备用 col 容量为示例。"); },
    fields: { ...baseline },
  },
  {
    id: 'ccr-single-segment', get label() { return t("CCR · 单 segment"); }, get name() { return t("32768×2048 单 segment CCR"); },
    get summary() { return t("整个 region 作为一个 segment；8 个 CCR 子组，每组 2 条备用 col，Region 默认共享 128 条全局备用 row。备用 col 容量为示例。"); },
    fields: { ...baseline, sectionsPerSegment: '96' },
  },
];

function integer(value: string, label: string, min: number, max: number): number {
  const trimmed = value.trim();
  const n = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(t("{0}必须是 {1}～{2} 之间的整数。", label, min, max));
  return n;
}

function definition(fields: ArchitectureFields, templateId: string) {
  if (!ARCHITECTURE_TEMPLATES.some(template => template.id === templateId)) throw new Error(t("请选择有效的 CCR 预设。"));
  const rows = integer(fields.rows, t("Region row 数"), 1, 1_048_576);
  const cols = integer(fields.cols, t("Region col 数"), 1, 1_048_576);
  const coordinateBase = integer(fields.coordinateBase, t("坐标起点"), 0, 1);
  const spareRows = integer(fields.spareRows, t("Region 全局备用 row 数"), 0, 1_048_576);
  const groups = integer(fields.ccrGroupsPerSegment, t("每 segment 的 CCR 子组数"), 1, 256);
  const entries = fields.ccrSparesPerGroup.split(/[,，]/).map(value => value.trim());
  if (entries.length !== 1 && entries.length !== groups) throw new Error(t("CCR 备用 col 容量请填一个统一值，或 {0} 个按子组排列的数值。", groups));
  const counts = entries.map((value, index) => integer(value, t("CCR 第 {0} 子组容量", index), 0, 1_048_576));
  const capacities = counts.length === 1 ? Array.from({ length: groups }, () => counts[0]) : counts;
  const sectionCount = integer(fields.sectionCount, t("Section 总数"), 1, 1_048_576);
  const sectionsPerSegment = integer(fields.sectionsPerSegment, t("每 segment 的 section 数"), 1, sectionCount);
  const sectionGroupSize = integer(fields.sectionGroupSize, t("Section group row 跨度"), 1, 1_048_576);
  const subsectionSize = integer(fields.subsectionSize, t("Subsection row 步长"), 1, 1_048_576);
  const subsectionsPerGroup = integer(fields.subsectionsPerGroup, t("每 section group 的 subsection 数"), 1, sectionCount);
  if (sectionCount % subsectionsPerGroup) throw new Error(t("Section 总数必须能被每 group 的 subsection 数整除。"));
  if (sectionCount % sectionsPerSegment) throw new Error(t("Section 总数必须能被每 segment 的 section 数整除。"));
  if (sectionGroupSize > subsectionSize * subsectionsPerGroup) throw new Error(t("Segment 映射无效：subsection row 跨度不足以覆盖 section group。"));
  const expectedRows = (sectionCount / subsectionsPerGroup) * sectionGroupSize;
  if (rows !== expectedRows) throw new Error(t("Segment 映射对应 {0} row，与 Region row 数 {1} 不一致。", expectedRows, rows));
  if (fields.notes.length > 4000) throw new Error(t("备注不能超过 4000 字符。"));
  return {
    kind: 'pixel-architecture', version: 2, template_id: templateId,
    model: 'region-ccr',
    array: { rows, cols, coordinate_base: coordinateBase },
    device: {
      spare_rows: spareRows,
      ccr_groups_per_segment: groups,
      ccr_spares_per_group: capacities,
      row_layout: {
        section_count: sectionCount, sections_per_segment: sectionsPerSegment,
        section_group_size: sectionGroupSize, subsection_size: subsectionSize,
        subsections_per_group: subsectionsPerGroup,
      },
    },
    notes: fields.notes,
  };
}

export function serializeArchitecture(fields: ArchitectureFields, templateId: string): string {
  return JSON.stringify(definition(fields, templateId), null, 2);
}

export type CcrDefinition = ReturnType<typeof definition>;

export function ccrDefinition(description: string): CcrDefinition | null {
  const parsed = parseArchitecture(description);
  return parsed ? definition(parsed.fields, parsed.templateId) : null;
}

/** Internal addresses are zero-based, including when displayed coordinates start at 1. */
export function ccrSegmentForRow(value: CcrDefinition, row: number): number {
  const layout = value.device.row_layout;
  const section = Math.floor(row / layout.section_group_size) * layout.subsections_per_group
    + Math.floor((row % layout.section_group_size) / layout.subsection_size);
  return Math.floor(section / layout.sections_per_segment);
}

/** Half-open row interval. Reserved segments may have no rows. Do not divide rows evenly. */
export function ccrSegmentRows(value: CcrDefinition, segment: number): [number, number] {
  function boundary(target: number) {
    let low = 0; let high = value.array.rows;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ccrSegmentForRow(value, middle) < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  return [boundary(segment), boundary(segment + 1)];
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** Only a complete CCR definition is editable as parameters; other text is kept verbatim. */
export function parseArchitecture(description: string): { templateId: string; fields: ArchitectureFields } | null {
  try {
    const value: unknown = JSON.parse(description);
    if (!object(value) || !exactKeys(value, ['kind', 'version', 'template_id', 'model', 'array', 'device', 'notes'])) return null;
    if (value.kind !== 'pixel-architecture' || value.version !== 2 || value.model !== 'region-ccr') return null;
    if (typeof value.template_id !== 'string' || typeof value.notes !== 'string') return null;
    const array = value.array; const device = value.device;
    if (!object(array) || !exactKeys(array, ['rows', 'cols', 'coordinate_base']) || !Object.values(array).every(numeric)) return null;
    if (!object(device) || !exactKeys(device, ['spare_rows', 'ccr_groups_per_segment', 'ccr_spares_per_group', 'row_layout'])) return null;
    if (!numeric(device.spare_rows) || !numeric(device.ccr_groups_per_segment)) return null;
    const capacities = device.ccr_spares_per_group;
    if (!Array.isArray(capacities) || capacities.length !== device.ccr_groups_per_segment || !capacities.every(numeric)) return null;
    const layout = device.row_layout;
    if (!object(layout) || !exactKeys(layout, ['section_count', 'sections_per_segment', 'section_group_size', 'subsection_size', 'subsections_per_group']) || !Object.values(layout).every(numeric)) return null;
    const fields: ArchitectureFields = {
      rows: String(array.rows), cols: String(array.cols), coordinateBase: String(array.coordinate_base),
      spareRows: String(device.spare_rows), ccrGroupsPerSegment: String(device.ccr_groups_per_segment),
      ccrSparesPerGroup: capacities.every(value => value === capacities[0]) ? String(capacities[0]) : capacities.join(', '),
      sectionCount: String(layout.section_count), sectionsPerSegment: String(layout.sections_per_segment),
      sectionGroupSize: String(layout.section_group_size), subsectionSize: String(layout.subsection_size),
      subsectionsPerGroup: String(layout.subsections_per_group), notes: value.notes,
    };
    definition(fields, value.template_id);
    return { templateId: value.template_id, fields };
  } catch { return null; }
}

export function architectureSummary(description: string): string | null {
  const parsed = parseArchitecture(description);
  if (!parsed) return null;
  const value = definition(parsed.fields, parsed.templateId);
  const segments = value.device.row_layout.section_count / value.device.row_layout.sections_per_segment;
  const capacities = value.device.ccr_spares_per_group;
  const capacity = capacities.every(count => count === capacities[0]) ? t("每组 {0} col", capacities[0]) : t("每段共 {0} col", capacities.reduce((sum, count) => sum + count, 0));
  return t("Region {0} × {1} · {2} segment · Region 全局备用 row {3} · CCR {4} 组/segment，{5}{6}", value.array.rows, value.array.cols, segments, value.device.spare_rows, value.device.ccr_groups_per_segment, capacity, value.array.coordinate_base ? t(" · 1 基坐标") : '');
}
