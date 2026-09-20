import { useEffect, useRef, useState } from 'react';
import type { ArchitecturePreview as PreviewRecord } from '@pixel/contracts';
import { validateArchitectureScene } from '@pixel/contracts/architecture-scene';
import { fileUrl } from './api';
import { PixiDrawPreview } from './PixiDrawPreview';
import { getPixelDensity } from './pixelGrid';

export function ArchitecturePreview({ previews }: { previews: PreviewRecord[] }) {
  const [selected, setSelected] = useState('');
  const preview = previews.find(item => item.file.id === selected) ?? previews[0];
  if (!preview) return null;
  return <div className="architecture-preview">
    <div className="panel-actions"><span>Agent 绘图 · Pixi</span>
      {previews.length > 1 && <select aria-label="预览版本" value={preview.file.id} onChange={event => setSelected(event.target.value)}>{previews.map((item, index) => <option key={item.file.id} value={item.file.id}>版本 {previews.length - index} · {new Date(item.createdAt).toLocaleString()}</option>)}</select>}
    </div>
    {preview.scene.draw ? <PixiDrawPreview key={preview.file.id} preview={preview} /> : <LegacyArchitecturePreview key={preview.file.id} previews={[preview]} />}
  </div>;
}

function LegacyArchitecturePreview({ previews }: { previews: PreviewRecord[] }) {
  const preview = previews[0];
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' });
    observer.observe(host); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !preview || !visible) return;
    const scene = validateArchitectureScene(preview.scene);
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setReady(false); setError('');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', scene.description);
    canvas.style.width = `${scene.canvas.width}rem`; canvas.style.height = `${scene.canvas.height}rem`;
    host.appendChild(canvas);
    void (async () => {
      const { Application, Graphics, Text } = await import('pixi.js');
      await document.fonts.load('12px "Fusion Pixel"'); await document.fonts.ready;
      if (cancelled) return;
      const app = new Application();
      try {
        await app.init({ canvas, width: scene.canvas.width, height: scene.canvas.height, resolution: getPixelDensity(),
          preference: 'webgl', antialias: false, roundPixels: true, autoDensity: false, autoStart: false, sharedTicker: false });
      } catch (err) { app.stage.destroy({ children: true }); app.renderer?.destroy(); throw err; }
      if (cancelled) { app.destroy(); return; }
      const paint = () => {
        const style = getComputedStyle(document.documentElement);
        const color = (key: string) => {
          const value = style.getPropertyValue(scene.palette[key]).trim();
          if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`主题颜色不可用：${key}`);
          return value;
        };
        for (const child of app.stage.removeChildren()) child.destroy();
        app.renderer.background.color = color(scene.canvas.background);
        let graphics: InstanceType<typeof Graphics> | undefined;
        const rectangle = (x: number, y: number, width: number, height: number, fill: string) => {
          if (!graphics) { graphics = new Graphics(); app.stage.addChild(graphics); }
          graphics.rect(x, y, width, height).fill(color(fill));
        };
        for (const node of scene.nodes) {
          if (node.type === 'text') {
            graphics = undefined;
            const label = new Text({ text: node.text, resolution: getPixelDensity(), style: { fontFamily: 'Fusion Pixel', fontSize: 12, fontWeight: '400', fill: color(node.color) } });
            label.roundPixels = true; label.position.set(node.x, node.y);
            if (Math.ceil(label.width) > node.width || Math.ceil(label.height) > node.height) {
              label.destroy(); throw new Error(`文字超出预留尺寸：${node.id}，请让Agent调整布局`);
            }
            app.stage.addChild(label);
          } else if (node.type === 'grid') {
            const width = node.cols * node.cellWidth + node.lineWidth;
            const height = node.rows * node.cellHeight + node.lineWidth;
            rectangle(node.x, node.y, width, height, node.fill);
            for (let c = 0; c <= node.cols; c++) rectangle(node.x + c * node.cellWidth, node.y, node.lineWidth, height, node.lineColor);
            for (let r = 0; r <= node.rows; r++) rectangle(node.x, node.y + r * node.cellHeight, width, node.lineWidth, node.lineColor);
          } else rectangle(node.x, node.y, node.width, node.height, node.type === 'rect' ? node.fill : node.color);
        }
        app.render(); canvas.style.visibility = 'visible'; setReady(true); setError('');
      };
      const redraw = () => { try { paint(); } catch (err) { canvas.style.visibility = 'hidden'; setReady(false); setError(err instanceof Error ? err.message : '预览绘制失败'); } };
      const observer = new MutationObserver(() => { app.renderer.resize(scene.canvas.width, scene.canvas.height, getPixelDensity()); redraw(); });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-pixel-ratio'] });
      const lost = (event: Event) => { event.preventDefault(); setError('图形上下文丢失，请重新打开预览'); setReady(false); };
      canvas.addEventListener('webglcontextlost', lost);
      cleanup = () => { observer.disconnect(); canvas.removeEventListener('webglcontextlost', lost); app.destroy(); };
      redraw();
    })().catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : '预览加载失败'); setReady(false); } });
    return () => { cancelled = true; cleanup?.(); canvas.remove(); };
  }, [preview, visible]);
  if (!preview) return null;
  const { scene } = preview;
  return <div className="architecture-preview">
    <div className="architecture-canvas-scroll" tabIndex={0} role="region" aria-label={`${scene.title}预览，可横向滚动`}>
      <div ref={hostRef} className="architecture-canvas" data-render-state={error ? 'error' : ready ? 'ready' : 'loading'} style={{ width: `${scene.canvas.width}rem`, height: `${scene.canvas.height}rem` }} />
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!ready && !error && visible && <p role="status">正在绘制…</p>}
    <p className="task-note">{scene.description}</p>
    {scene.assumptions.length > 0 && <ul>{scene.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    <details className="drawing-record"><summary>绘图记录 · {scene.canvas.width} × {scene.canvas.height} 格 · {scene.nodes.length} 个图元</summary>
      <p>1 格对应当前像素网格；Fusion Pixel 12 格，行高 16 格。</p>
      <p>架构指纹：<code>{scene.fingerprint}</code></p>
      <div className="drawing-table"><table><thead><tr><th>颜色角色</th><th>主题变量</th><th>亮色记录</th><th>暗色记录</th></tr></thead><tbody>{Object.entries(scene.palette).map(([role, token]) => <tr key={role}><td>{role}</td><td>{token}</td><td>{preview.themeSnapshot[token]?.light}</td><td>{preview.themeSnapshot[token]?.dark}</td></tr>)}</tbody></table></div>
      <div className="drawing-table"><table><thead><tr><th>区域 / 分割线</th><th>起点</th><th>尺寸 / 网格</th><th>颜色角色</th></tr></thead><tbody>{scene.nodes.filter(node => node.type !== 'text').map(node => <tr key={node.id}><td>{node.label || node.id}</td><td>{node.x}, {node.y}</td><td>{node.type === 'grid' ? `${node.rows} × ${node.cols}；单元 ${node.cellWidth} × ${node.cellHeight}；线宽 ${node.lineWidth}` : `${node.width} × ${node.height}`}</td><td>{node.type === 'grid' ? node.lineColor : node.type === 'rect' ? node.fill : node.color}</td></tr>)}</tbody></table></div>
      <div className="panel-actions"><a className="action-button" href={fileUrl(preview.file)} download>下载场景 JSON</a><a className="action-button" href={fileUrl(preview.recipe)} download>下载 Agent 脚本</a></div>
    </details>
  </div>;
}
