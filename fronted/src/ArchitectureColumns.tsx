import { t } from './i18n';
import { architectureColumns } from './architectureTemplates';

/** Header cells for the key CCR configuration columns; pair with ArchitectureCells. */
export function ArchitectureHeaders({ region = false }: { region?: boolean }) {
  return <>
    <th scope="col" className="sheet-num">{t("备用 row")}</th>
    <th scope="col" className="sheet-num">{t("CCR col/组")}</th>
    <th scope="col" className="sheet-num sheet-optional">{t("CCR 组/段")}</th>
    <th scope="col" className="sheet-num sheet-optional">Segment</th>
    {region && <><th scope="col" className="sheet-num sheet-optional">Row</th><th scope="col" className="sheet-num sheet-optional">Col</th></>}
  </>;
}

export function ArchitectureCells({ description, region = false }: { description?: string; region?: boolean }) {
  const value = description ? architectureColumns(description) : null;
  const cell = (content: number | string | undefined, optional = false) => <td className={`sheet-num sheet-muted ${optional ? 'sheet-optional' : ''}`}>{content ?? '–'}</td>;
  return <>
    {cell(value?.spareRows)}{cell(value?.ccrCols)}{cell(value?.groups, true)}{cell(value?.segments, true)}
    {region && <>{cell(value?.rows, true)}{cell(value?.cols, true)}</>}
  </>;
}
