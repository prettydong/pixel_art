/** One summary number; emphasis comes from colour and order, never a second font size. */
export function StatTile({ label, value, detail, highlight = false }: { label: string; value: string; detail?: string; highlight?: boolean }) {
  return <div className={`stat-tile ${highlight ? 'stat-highlight' : ''}`}><span>{label}</span><span className="stat-value">{value}</span>{detail && <span>{detail}</span>}</div>;
}
