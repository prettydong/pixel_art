// Column resizing for every `.sheet` table. Sheets size columns to their content; dragging a header cell's right edge
// switches that table to fixed widths, and double-clicking the edge returns it to content sizing.
const EDGE = 6;
const MIN_WIDTH = 48;

function edgeCell(event: MouseEvent): HTMLTableCellElement | null {
  const cell = (event.target as Element | null)?.closest?.<HTMLTableCellElement>('.sheet > thead th');
  if (!cell || cell.classList.contains('sheet-check')) return null;
  const right = cell.getBoundingClientRect().right;
  return event.clientX <= right && right - event.clientX <= EDGE ? cell : null;
}

function headerCells(table: HTMLTableElement) {
  return Array.from(table.tHead?.rows[0]?.cells ?? []);
}

// Fixed layout with explicit widths on every column lets one column change without the others reflowing.
function freeze(table: HTMLTableElement) {
  if (table.dataset.resized) return;
  const cells = headerCells(table);
  const widths = cells.map(cell => cell.getBoundingClientRect().width);
  cells.forEach((cell, index) => { cell.dataset.originalWidth = cell.style.width; cell.style.width = `${widths[index]}px`; });
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  table.style.tableLayout = 'fixed';
  table.dataset.resized = 'true';
}

function reset(table: HTMLTableElement) {
  headerCells(table).forEach(cell => { cell.style.width = cell.dataset.originalWidth ?? ''; delete cell.dataset.originalWidth; });
  table.style.width = '';
  table.style.tableLayout = '';
  delete table.dataset.resized;
}

function start(event: PointerEvent) {
  if (event.button !== 0) return;
  const cell = edgeCell(event);
  const table = cell?.closest('table');
  if (!cell || !table) return;
  event.preventDefault();
  freeze(table);
  const startX = event.clientX;
  const startWidth = cell.getBoundingClientRect().width;
  const startTable = table.getBoundingClientRect().width;
  document.documentElement.classList.add('sheet-resizing');
  const move = (next: PointerEvent) => {
    const width = Math.max(MIN_WIDTH, startWidth + next.clientX - startX);
    cell.style.width = `${width}px`;
    table.style.width = `${startTable + width - startWidth}px`;
  };
  const stop = () => {
    document.documentElement.classList.remove('sheet-resizing');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function restore(event: MouseEvent) {
  const table = edgeCell(event)?.closest('table');
  if (table) reset(table);
}

export function startSheetResize() {
  document.addEventListener('pointerdown', start);
  document.addEventListener('dblclick', restore);
  return () => { document.removeEventListener('pointerdown', start); document.removeEventListener('dblclick', restore); };
}

// Ref callback for a `.sheet-pinned` table: keeps its leading columns' sticky offsets (--pin-N) in step with their widths,
// and the visible frame width (--frame-width) so expanded detail rows stay in view.
export function pinColumns(count: number) {
  return (table: HTMLTableElement | null) => {
    if (!table) return;
    const cells = headerCells(table).slice(0, count);
    const frame = table.parentElement;
    const update = () => {
      let left = 0;
      cells.forEach((cell, index) => { table.style.setProperty(`--pin-${index}`, `${left}px`); left += cell.getBoundingClientRect().width; });
      if (frame) table.style.setProperty('--frame-width', `${frame.clientWidth}px`);
    };
    const observer = new ResizeObserver(update);
    cells.forEach(cell => observer.observe(cell));
    if (frame) observer.observe(frame);
    update();
    return () => observer.disconnect();
  };
}
