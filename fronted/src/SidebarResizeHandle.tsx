import { useEffect, useRef, useState } from 'react';
import { getPixelUnit, getSidebarSizing, setSidebarWidth } from './pixelGrid';

export function SidebarResizeHandle({ disabled }: { disabled: boolean }) {
  const [sizing, setSizing] = useState(getSidebarSizing);
  const drag = useRef<{ id: number; left: number; moved: boolean } | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => setSizing(getSidebarSizing());
    window.addEventListener('pixel:sidebar-width', update);
    return () => {
      window.removeEventListener('pixel:sidebar-width', update);
      if (drag.current?.moved) setSidebarWidth(getSidebarSizing().width);
      drag.current = null;
      delete document.documentElement.dataset.sidebarResizing;
    };
  }, []);
  function finish(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    const moved = drag.current.moved;
    drag.current = null;
    delete document.documentElement.dataset.sidebarResizing;
    if (moved) setSidebarWidth(getSidebarSizing().width);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={handle} className="sidebar-resize-handle" role="separator" aria-label="调整导航栏宽度" aria-orientation="vertical" aria-controls="chat-sidebar"
    aria-valuemin={sizing.minimum} aria-valuemax={sizing.maximum} aria-valuenow={sizing.width} aria-valuetext={`窗口宽度的 ${Math.round(sizing.width / sizing.viewport * 100)}%`}
    aria-disabled={disabled} tabIndex={disabled ? -1 : 0} title="拖动调整宽度；双击恢复默认 20%"
    onPointerDown={event => {
      if (disabled || event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      drag.current = { id: event.pointerId, left: event.currentTarget.parentElement!.getBoundingClientRect().left, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.documentElement.dataset.sidebarResizing = 'true';
    }}
    onPointerMove={event => {
      if (drag.current?.id !== event.pointerId) return;
      const width = Math.round((event.clientX - drag.current.left) / getPixelUnit());
      const current = getSidebarSizing();
      const next = Math.max(current.minimum, Math.min(current.maximum, width));
      if (next !== current.width) { drag.current.moved = true; setSidebarWidth(next, false); }
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => { if (!disabled) setSidebarWidth(null); }}
    onKeyDown={event => {
      if (disabled) return;
      const current = getSidebarSizing(); const step = event.shiftKey ? 16 : 4;
      if (event.key === 'ArrowLeft') setSidebarWidth(current.width - step);
      else if (event.key === 'ArrowRight') setSidebarWidth(current.width + step);
      else if (event.key === 'Home') setSidebarWidth(current.minimum);
      else if (event.key === 'End') setSidebarWidth(current.maximum);
      else if (event.key === 'Enter') setSidebarWidth(null);
      else return;
      event.preventDefault();
    }} />;
}
