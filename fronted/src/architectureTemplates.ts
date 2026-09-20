/** Versioned editor format stored in the existing architecture description field.
 * This is an architecture definition, not an executable experiment plan.
 */
export type ArchitectureFields = {
  rows: string;
  cols: string;
  coordinateBase: string;
  spareRows: string;
  columnGroups: string;
  spareColsPerGroup: string;
  columnGroupOffset: string;
  notes: string;
};

const baseline: ArchitectureFields = {
  rows: '1024', cols: '1024', coordinateBase: '0', spareRows: '2',
  columnGroups: '1', spareColsPerGroup: '2', columnGroupOffset: '0', notes: '',
};

export const ARCHITECTURE_TEMPLATES: readonly {
  id: string; label: string; name: string; summary: string; fields: ArchitectureFields;
}[] = [
  {
    id: 'row-column', label: '普通行列冗余', name: '1024×1024 行列冗余',
    summary: '1024 行 × 1024 列，2 条备用行、2 条备用列（单组）。',
    fields: { ...baseline },
  },
  {
    id: 'row-only', label: '仅行冗余', name: '1024×1024 仅行冗余',
    summary: '1024 行 × 1024 列，4 条备用行，不使用备用列。',
    fields: { ...baseline, spareRows: '4', spareColsPerGroup: '0' },
  },
  {
    id: 'grouped-columns', label: '8 组列冗余', name: '1024×1024 8组列冗余',
    summary: '1024 行 × 1024 列，2 条备用行，8 组列资源，每组 1 条备用列（总计 8 条）。',
    fields: { ...baseline, columnGroups: '8', spareColsPerGroup: '1' },
  },
  {
    id: 'wide-array', label: '大阵列 · 8 组列冗余', name: '1024×8192 8组列冗余',
    summary: '1024 行 × 8192 列，4 条备用行，8 组列资源，每组 2 条备用列（总计 16 条）。',
    fields: { ...baseline, cols: '8192', spareRows: '4', columnGroups: '8', spareColsPerGroup: '2' },
  },
];

function integer(value: string, label: string, min: number, max: number): number {
  const trimmed = value.trim();
  const n = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${label}必须是 ${min}～${max} 之间的整数。`);
  }
  return n;
}

function definition(fields: ArchitectureFields, templateId: string) {
  if (!ARCHITECTURE_TEMPLATES.some(template => template.id === templateId)) throw new Error('请选择一个有效模板。');
  const rows = integer(fields.rows, '阵列行数', 1, 1_048_576);
  const cols = integer(fields.cols, '阵列列数', 1, 1_048_576);
  const coordinateBase = integer(fields.coordinateBase, '坐标基准', 0, 1);
  const spareRows = integer(fields.spareRows, '备用行数', 0, 1_048_576);
  const columnGroups = integer(fields.columnGroups, '列资源组数', 1, 256);
  const offset = integer(fields.columnGroupOffset, '列分组偏移', 0, columnGroups - 1);
  const entries = fields.spareColsPerGroup.split(/[,，]/).map(value => value.trim());
  if (entries.length !== 1 && entries.length !== columnGroups) {
    throw new Error(`备用列容量请填一个统一数值，或恰好 ${columnGroups} 个按组排列的数值。`);
  }
  const counts = entries.map((value, index) => integer(value, `备用列容量（第 ${index} 组）`, 0, 1_048_576));
  const capacities = counts.length === 1 ? Array.from({ length: columnGroups }, () => counts[0]) : counts;
  if (fields.notes.length > 4000) throw new Error('补充说明不能超过 4000 字符。');
  return {
    kind: 'pixel-architecture', version: 1, template_id: templateId,
    model: 'independent-full-row-column',
    array: { rows, cols, coordinate_base: coordinateBase },
    device: {
      spare_rows: spareRows,
      column_groups: columnGroups,
      spare_cols_per_group: capacities,
      column_group_offset: offset,
    },
    notes: fields.notes,
  };
}

export function serializeArchitecture(fields: ArchitectureFields, templateId: string): string {
  return JSON.stringify(definition(fields, templateId), null, 2);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Only our complete known format may use the parameter editor. Unknown versions,
 * extra fields and legacy prose remain verbatim in the free-text editor.
 */
export function parseArchitecture(description: string): { templateId: string; fields: ArchitectureFields } | null {
  try {
    const value: unknown = JSON.parse(description);
    if (!object(value) || !exactKeys(value, ['kind', 'version', 'template_id', 'model', 'array', 'device', 'notes'])) return null;
    if (value.kind !== 'pixel-architecture' || value.version !== 1 || value.model !== 'independent-full-row-column') return null;
    if (typeof value.template_id !== 'string' || typeof value.notes !== 'string') return null;
    const array = value.array;
    const device = value.device;
    if (!object(array) || !exactKeys(array, ['rows', 'cols', 'coordinate_base']) || !Object.values(array).every(numeric)) return null;
    if (!object(device) || !exactKeys(device, ['spare_rows', 'column_groups', 'spare_cols_per_group', 'column_group_offset'])) return null;
    if (![device.spare_rows, device.column_groups, device.column_group_offset].every(numeric)) return null;
    const capacities = device.spare_cols_per_group;
    if (!Array.isArray(capacities) || capacities.length !== device.column_groups || !capacities.every(numeric)) return null;
    const fields: ArchitectureFields = {
      rows: String(array.rows), cols: String(array.cols), coordinateBase: String(array.coordinate_base),
      spareRows: String(device.spare_rows), columnGroups: String(device.column_groups),
      spareColsPerGroup: capacities.every(value => value === capacities[0]) ? String(capacities[0]) : capacities.join(', '),
      columnGroupOffset: String(device.column_group_offset), notes: value.notes,
    };
    definition(fields, value.template_id);
    return { templateId: value.template_id, fields };
  } catch { return null; }
}

export function architectureSummary(description: string): string | null {
  const parsed = parseArchitecture(description);
  if (!parsed) return null;
  const value = definition(parsed.fields, parsed.templateId);
  const total = value.device.spare_cols_per_group.reduce((sum, count) => sum + count, 0);
  return `${value.array.rows} 行 × ${value.array.cols} 列 · 备用行 ${value.device.spare_rows} · 备用列总计 ${total}（${value.device.column_groups} 组）· ${value.array.coordinate_base} 基坐标`;
}
