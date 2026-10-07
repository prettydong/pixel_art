import { t } from './i18n';

/** Agent-declared assumptions are data limitations, so they stay visible below the drawing. */
export function DrawingAssumptions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <section className="drawing-assumptions" aria-label={t("假设与限制")}>
    <p>{t("假设与限制（{0}）", items.length)}</p>
    <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  </section>;
}
