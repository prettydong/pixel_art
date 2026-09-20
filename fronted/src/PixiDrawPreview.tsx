import { useEffect, useRef, useState } from 'react';
import type { ArchitecturePreview } from '@pixel/contracts';
import type * as Pixi from 'pixi.js';
import { fileUrl } from './api';

// Logical coordinates: x = column, y = row. One world unit is one real cell.
export type DrawView = { x: number; y: number; width: number; height: number; scale: number; gridStep: number; viewportWidth: number; viewportHeight: number };
export type DrawContext = {
  PIXI: typeof Pixi; world: Pixi.Container; overlay: Pixi.Container;
  grid: { rows: number; cols: number }; colors: Record<string, string>; view: DrawView;
  toScreen: (col: number, row: number) => { x: number; y: number };
  text: (text: string, x: number, y: number, color?: string) => Pixi.Text;
};
type Controls = { zoom: (factor: number) => void; fit: () => void; cell: () => void; go: (row: number, col: number) => void };

export function PixiDrawPreview({ preview }: { preview: ArchitecturePreview }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState({ step: 1, lines: 0, scale: 1 });
  const [hover, setHover] = useState('拖动平移；滚轮缩放');
  const [row, setRow] = useState('0'); const [col, setCol] = useState('0');
  const { scene } = preview; const drawing = scene.draw!;
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' });
    observer.observe(host); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !visible) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setReady(false); setError('');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${scene.title}，${drawing.grid.rows}行${drawing.grid.cols}列，可缩放和平移`);
    host.appendChild(canvas);
    void (async () => {
      const PIXI = await import('pixi.js');
      await document.fonts.load('12px "Fusion Pixel"'); await document.fonts.ready;
      if (cancelled) return;
      if (!preview.draw) throw new Error('缺少 Agent draw 函数');
      const url = URL.createObjectURL(new Blob([preview.draw.source], { type: 'text/javascript' }));
      let draw: (ctx: DrawContext) => void;
      try {
        const module = await import(/* @vite-ignore */ url);
        if (typeof module.draw !== 'function') throw new Error('draw.mjs 必须导出 draw(ctx) 函数');
        draw = module.draw;
      } finally { URL.revokeObjectURL(url); }
      if (cancelled) return;
      const app = new PIXI.Application();
      let width = 640; const height = scene.canvas.height;
      const measure = () => Math.max(80, Math.floor(host.clientWidth / parseFloat(getComputedStyle(document.documentElement).fontSize)));
      width = measure();
      canvas.style.width = `${width}rem`; canvas.style.height = `${height}rem`;
      try { await app.init({ canvas, width, height, resolution: 3, preference: 'webgl', antialias: false, roundPixels: true, autoDensity: false, autoStart: false, sharedTicker: false }); }
      catch (err) { app.stage.destroy({ children: true }); app.renderer?.destroy(); throw err; }
      if (cancelled) { app.destroy(); return; }
      const { rows, cols } = drawing.grid;
      let scale = 1; let offsetX = 0; let offsetY = 0; let fitting = true;
      let frame = 0;
      const padX = () => Math.min(48, Math.floor(width / 4));
      const padY = Math.min(48, Math.floor(height / 4));
      const fitScale = () => Math.min(Math.max(1, width - padX() * 2) / cols, Math.max(1, height - padY * 2) / rows);
      const bound = () => {
        offsetX = Math.round(cols * scale < width - padX() * 2 ? (width - cols * scale) / 2 : Math.min(padX(), Math.max(width - padX() - cols * scale, offsetX)));
        offsetY = Math.round(rows * scale < height - padY * 2 ? (height - rows * scale) / 2 : Math.min(padY, Math.max(height - padY - rows * scale, offsetY)));
      };
      const toScreen = (x: number, y: number) => ({ x: Math.round(offsetX + x * scale), y: Math.round(offsetY + y * scale) });
      const paint = () => {
        frame = 0;
        if (cancelled) return;
        try {
          bound();
          for (const child of app.stage.removeChildren()) child.destroy({ children: true });
          const style = getComputedStyle(document.documentElement);
          const colors = Object.fromEntries(Object.entries(scene.palette).map(([key, token]) => [key, style.getPropertyValue(token).trim()]));
          app.renderer.background.color = colors[scene.canvas.background];
          let step = 1; while (step * scale < 8) step *= 2;
          const x = Math.max(0, -offsetX / scale); const y = Math.max(0, -offsetY / scale);
          const right = Math.min(cols, (width - offsetX) / scale); const bottom = Math.min(rows, (height - offsetY) / scale);
          const grid = new PIXI.Graphics(); app.stage.addChild(grid);
          const origin = toScreen(0, 0); const end = toScreen(cols, rows);
          grid.rect(origin.x, origin.y, end.x - origin.x, end.y - origin.y).fill(colors[drawing.grid.fill]);
          let lines = 0;
          const vertical = (col: number) => { const at = toScreen(col, 0); grid.rect(at.x, Math.max(0, origin.y), 1, Math.min(height, end.y) - Math.max(0, origin.y)).fill(colors[drawing.grid.lineColor]); lines++; };
          const horizontal = (row: number) => { const at = toScreen(0, row); grid.rect(Math.max(0, origin.x), at.y, Math.min(width, end.x) - Math.max(0, origin.x), 1).fill(colors[drawing.grid.lineColor]); lines++; };
          for (let c = Math.ceil(x / step) * step; c <= right; c += step) vertical(c);
          for (let r = Math.ceil(y / step) * step; r <= bottom; r += step) horizontal(r);
          if (cols % step && end.x <= width) vertical(cols);
          if (rows % step && end.y <= height) horizontal(rows);
          const world = new PIXI.Container(); world.position.set(offsetX, offsetY); world.scale.set(scale); app.stage.addChild(world);
          const overlay = new PIXI.Container(); app.stage.addChild(overlay);
          const text: DrawContext['text'] = (value, px, py, color = colors.ink || style.getPropertyValue('--text').trim()) => {
            const label = new PIXI.Text({ text: value, resolution: 3, style: { fontFamily: 'Fusion Pixel', fontSize: 12, fontWeight: '400', fill: color } });
            label.roundPixels = true; label.position.set(Math.round(px), Math.round(py)); overlay.addChild(label); return label;
          };
          draw({ PIXI, world, overlay, grid: { rows, cols }, colors,
            view: { x, y, width: right - x, height: bottom - y, scale, gridStep: step, viewportWidth: width, viewportHeight: height }, toScreen, text });
          app.render(); setStatus({ step, lines, scale }); setReady(true); setError(''); canvas.style.visibility = 'visible';
        } catch (err) { canvas.style.visibility = 'hidden'; setError(err instanceof Error ? err.message : 'draw 执行失败'); setReady(false); }
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
      const fit = () => { fitting = true; scale = fitScale(); offsetX = (width - cols * scale) / 2; offsetY = (height - rows * scale) / 2; schedule(); };
      const zoomAt = (factor: number, px = width / 2, py = height / 2) => {
        const next = Math.min(48, Math.max(fitScale(), scale * factor));
        offsetX = px - (px - offsetX) * next / scale; offsetY = py - (py - offsetY) * next / scale;
        scale = next; fitting = false; schedule();
      };
      controls.current = { fit, zoom: factor => zoomAt(factor), cell: () => zoomAt(16 / scale), go: (row, col) => {
        fitting = false; scale = 16; offsetX = width / 2 - (col + 0.5) * scale; offsetY = height / 2 - (row + 0.5) * scale; schedule();
      } };
      const point = (event: MouseEvent) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }; };
      const wheel = (event: WheelEvent) => { event.preventDefault(); const p = point(event); zoomAt(Math.exp(-event.deltaY * 0.002), p.x, p.y); };
      let drag: { x: number; y: number; pointerId: number } | undefined;
      const down = (event: PointerEvent) => { if (event.button !== 0) return; drag = { ...point(event), pointerId: event.pointerId }; canvas.setPointerCapture(event.pointerId); };
      const move = (event: PointerEvent) => {
        const p = point(event);
        if (drag && drag.pointerId === event.pointerId) { offsetX += p.x - drag.x; offsetY += p.y - drag.y; drag = { ...p, pointerId: event.pointerId }; fitting = false; schedule(); }
        const r = Math.floor((p.y - offsetY) / scale); const c = Math.floor((p.x - offsetX) / scale);
        setHover(r >= 0 && r < rows && c >= 0 && c < cols ? `行 ${r} · 列 ${c}（从 0 开始）` : '拖动平移；滚轮缩放');
      };
      const up = () => { drag = undefined; };
      canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
      const resize = new ResizeObserver(() => {
        const next = measure(); if (next === width) return;
        offsetX += (next - width) / 2; width = next; canvas.style.width = `${width}rem`; app.renderer.resize(width, height);
        if (fitting) fit(); else schedule();
      }); resize.observe(host);
      const theme = new MutationObserver(schedule); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
      const lost = (event: Event) => { event.preventDefault(); setError('图形上下文丢失，请重新打开预览'); setReady(false); };
      canvas.addEventListener('webglcontextlost', lost);
      cleanup = () => {
        controls.current = null; cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect();
        canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('webglcontextlost', lost); app.destroy(true, { children: true });
      };
      fit();
    })().catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : '绘图加载失败'); setReady(false); } });
    return () => { cancelled = true; cleanup?.(); canvas.remove(); };
  }, [preview, visible, scene, drawing]);
  return <div className="architecture-preview">
    <div className="panel-actions"><strong>{drawing.grid.rows} 行 × {drawing.grid.cols} 列</strong><span>{(drawing.grid.rows * drawing.grid.cols).toLocaleString()} 个单元</span></div>
    <div className="panel-actions draw-controls">
      <button className="action-button" disabled={!ready} onClick={() => controls.current?.fit()}>全图</button>
      <button className="action-button" disabled={!ready} aria-label="缩小架构" onClick={() => controls.current?.zoom(0.5)}>缩小</button>
      <button className="action-button" disabled={!ready} aria-label="放大架构" onClick={() => controls.current?.zoom(2)}>放大</button>
      <button className="action-button" disabled={!ready} onClick={() => controls.current?.cell()}>单元格</button>
      <form onSubmit={event => { event.preventDefault(); controls.current?.go(Number(row), Number(col)); }}>
        <label>行<input aria-label="定位行" type="number" required min={0} max={drawing.grid.rows - 1} step={1} value={row} onChange={event => setRow(event.target.value)} /></label>
        <label>列<input aria-label="定位列" type="number" required min={0} max={drawing.grid.cols - 1} step={1} value={col} onChange={event => setCol(event.target.value)} /></label>
        <button className="action-button" disabled={!ready} type="submit">定位</button>
      </form>
    </div>
    <div ref={hostRef} className="architecture-canvas pixi-draw-canvas" data-render-state={error ? 'error' : ready ? 'ready' : 'loading'} style={{ height: `${scene.canvas.height + 2}rem`, maxWidth: `${scene.canvas.width}rem` }} />
    {error && <p role="alert" className="error-text">{error}</p>}
    {!ready && !error && visible && <p role="status">正在绘制…</p>}
    <p className="task-note">{status.step === 1 ? '逐单元网格' : `当前每格 ${status.step} × ${status.step} 个单元`} · 当前绘制 {status.lines} 条网格线 · {hover}</p>
    <p className="task-note">{scene.description}</p>
    {scene.assumptions.length > 0 && <ul>{scene.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    <details className="drawing-record"><summary>绘图记录 · draw 函数 · {drawing.grid.rows} × {drawing.grid.cols}</summary>
      <p>真实坐标：列为 x、行为 y，每单位 1 个单元。视口上限 {scene.canvas.width} × {scene.canvas.height} 格，1 格 = 3 × 3 物理像素；网格线 1 格。Fusion Pixel 12 格。</p>
      <p>架构指纹：<code>{scene.fingerprint}</code></p>
      <p>draw SHA256：<code>{preview.draw?.sha256}</code></p>
      <div className="drawing-table"><table><thead><tr><th>区域 / 分割线</th><th>尺寸与位置（Agent 记录）</th><th>颜色角色</th></tr></thead><tbody>{drawing.records.map((record, i) => <tr key={i}><td>{record.label}</td><td>{record.geometry}</td><td>{record.color}</td></tr>)}</tbody></table></div>
      <div className="drawing-table"><table><thead><tr><th>颜色角色</th><th>主题变量</th><th>亮色记录</th><th>暗色记录</th></tr></thead><tbody>{Object.entries(scene.palette).map(([role, token]) => <tr key={role}><td>{role}</td><td>{token}</td><td>{preview.themeSnapshot[token]?.light}</td><td>{preview.themeSnapshot[token]?.dark}</td></tr>)}</tbody></table></div>
      <details><summary>查看 Agent draw 源码</summary><pre className="draw-source"><code>{preview.draw?.source}</code></pre></details>
      <div className="panel-actions">{preview.draw && <a className="action-button" href={fileUrl(preview.draw.file)} download>下载 draw.mjs</a>}<a className="action-button" href={fileUrl(preview.file)} download>下载场景 JSON</a><a className="action-button" href={fileUrl(preview.recipe)} download>下载生成脚本</a></div>
    </details>
  </div>;
}
