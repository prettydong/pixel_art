import { localizeMessage, getLanguage, t } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileRecord, ListResponse } from '@pixel/contracts';
import { MAX_WAFER_BYTES, decodeWafer, validateWaferLayout, type ProductRecord, type WaferRecord } from '@pixel/contracts/wafer-data';
import { SPATIAL_PATTERNS, type GenerationMetadata } from '@pixel/contracts/wafer-spatial';
import { WaferHeatmap } from './WaferHeatmap';
import { WaferGenerator } from './WaferGenerator';
import { api, errorText, fileUrl } from './api';
import { Download, Plus } from './PixelIcons';
import './WaferData.css';

type Props = { taskId: string; files: FileRecord[]; onChanged: () => Promise<void> };
type Decoded = ReturnType<typeof decodeWafer>;
const sameLayout = (left: ProductRecord, right: Decoded['layout']) => left.chipCount === right.chipCount && left.regionCount === right.regionCount && left.rows === right.rows && left.cols === right.cols;
const number = (value: string) => Math.max(0, Math.floor(Number(value) || 0));

export function WaferData({ taskId, files, onChanged }: Props) {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productId, setProductId] = useState('');
  const [wafers, setWafers] = useState<WaferRecord[]>([]);
  const [waferId, setWaferId] = useState('');
  const [chip, setChip] = useState(0);
  const [region, setRegion] = useState(0);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [wafersLoading, setWafersLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', chipCount: '1', regionCount: '1', rows: '1024', cols: '1024' });
  const inputRef = useRef<HTMLInputElement>(null);

  const product = products.find(item => item.id === productId) ?? null;
  const wafer = wafers.find(item => item.id === waferId) ?? null;
  const attachedFileIds = useMemo(() => new Set(files.map(file => file.id)), [files]);
  const selectedRegionIndex = product ? chip * product.regionCount + region : 0;
  const group = decoded?.groups.find(item => item.regionIndex === selectedRegionIndex);

  useEffect(() => {
    let alive = true; const controller = new AbortController(); setProductsLoading(true);
    api<ListResponse<ProductRecord>>('/products', { signal: controller.signal })
      .then(result => { if (alive) { setProducts(result.items); setProductId(previous => result.items.some(item => item.id === previous) ? previous : result.items[0]?.id ?? ''); } })
      .catch(err => { if (alive && (err as Error).name !== 'AbortError') setError(errorText(err)); })
      .finally(() => { if (alive) setProductsLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!productId) { setWafers([]); setWaferId(''); return; }
    let alive = true; const controller = new AbortController();
    setWafersLoading(true); setError(''); setWaferId(''); setDecoded(null); setPreviewError(''); setChip(0); setRegion(0);
    api<ListResponse<WaferRecord>>(`/products/${encodeURIComponent(productId)}/wafers`, { signal: controller.signal })
      .then(result => { if (alive) { setWafers(result.items); setWaferId(result.items[0]?.id ?? ''); } })
      .catch(err => { if (alive && (err as Error).name !== 'AbortError') setError(errorText(err)); })
      .finally(() => { if (alive) setWafersLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [productId]);
  useEffect(() => {
    if (!wafer || !product) { setDecoded(null); setPreviewError(''); setPreviewLoading(false); return; }
    let alive = true; const controller = new AbortController(); setPreviewLoading(true); setPreviewError(''); setDecoded(null);
    fetch(fileUrl(wafer.file), { credentials: 'same-origin', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(t("读取 wafer 失败（{0}）", response.status)); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > MAX_WAFER_BYTES) throw new Error(t("wafer 超过 {0} MB 限制", (MAX_WAFER_BYTES / 1024 / 1024).toFixed(0))); const value = decodeWafer(bytes); if (!sameLayout(product, value.layout)) throw new Error(t("wafer 的布局与产品定义不一致")); return value; })
      .then(value => { if (alive) setDecoded(value); })
      .catch(err => { if (alive && (err as Error).name !== 'AbortError') setPreviewError(errorText(err)); })
      .finally(() => { if (alive) setPreviewLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [wafer?.id, product?.id]);

  async function createProduct(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { name: form.name.trim(), chipCount: Number(form.chipCount), regionCount: Number(form.regionCount), rows: Number(form.rows), cols: Number(form.cols) };
      validateWaferLayout(body);
      const created = await api<ProductRecord>('/products', { method: 'POST', body: JSON.stringify(body) });
      setProducts(previous => [...previous, created]); selectProduct(created.id); setForm({ name: '', chipCount: '1', regionCount: '1', rows: '1024', cols: '1024' }); setNotice(t("已创建产品 {0}", created.name));
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function storeWafer(file: File, generation?: GenerationMetadata) {
      if (!product) throw new Error(t("请先选择产品"));
      setError(''); setNotice(t("正在校验文件…"));
      if (!file.name.toLowerCase().endsWith('.pwafer')) throw new Error(t("只接受 .pwafer 文件"));
      if (file.size > MAX_WAFER_BYTES) throw new Error(t("文件超过 {0} MB 限制", (MAX_WAFER_BYTES / 1024 / 1024).toFixed(0)));
      const parsed = decodeWafer(new Uint8Array(await file.arrayBuffer()));
      if (!sameLayout(product, parsed.layout)) throw new Error(t("文件布局与当前产品定义不一致，未上传"));
      setNotice(t("正在上传并关联当前任务…"));
      const upload = new FormData(); upload.append('file', file);
      const uploaded = await api<FileRecord>('/uploads', { method: 'POST', body: upload });
      const waferName = file.name.replace(/\.pwafer$/i, '').trim().slice(0, 120) || 'wafer';
      const created = await api<WaferRecord>(`/products/${encodeURIComponent(product.id)}/wafers`, { method: 'POST', body: JSON.stringify({ fileId: uploaded.id, name: waferName, generation }) });
      setWafers(previous => [...previous, created]); setWaferId(created.id); setDecoded(parsed); setChip(0); setRegion(0);
      try { await api(`/tasks/${encodeURIComponent(taskId)}/files`, { method: 'POST', body: JSON.stringify({ fileId: uploaded.id }) }); }
      catch (attachError) { setNotice(t("已登记 {0}，但未关联当前任务：{1}", created.name, errorText(attachError))); return; }
      try { await onChanged(); setNotice(t("已保存 {0}，并关联到当前任务", created.name)); }
      catch (refreshError) { setNotice(t("已登记并关联 {0}，但页面刷新失败：{1}", created.name, errorText(refreshError))); }
  }
  async function importWafer(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !product || busy || productsLoading || wafersLoading) return;
    setBusy(true); setError('');
    try { await storeWafer(file); }
    catch (err) { setError(errorText(err)); setNotice(''); } finally { setBusy(false); }
  }
  async function attachWafer() {
    if (!wafer || busy || attachedFileIds.has(wafer.fileId)) return;
    setBusy(true); setError(''); setNotice(t("正在关联到当前任务…"));
    try {
      await api(`/tasks/${encodeURIComponent(taskId)}/files`, { method: 'POST', body: JSON.stringify({ fileId: wafer.fileId }) });
      try { await onChanged(); setNotice(t("已关联到当前任务")); }
      catch (refreshError) { setNotice(t("已关联当前任务，但页面刷新失败：{0}", errorText(refreshError))); }
    }
    catch (err) { setError(errorText(err)); setNotice(''); } finally { setBusy(false); }
  }
  const step = (field: 'chip' | 'region', delta: number) => {
    const maximum = product ? (field === 'chip' ? product.chipCount : product.regionCount) - 1 : 0;
    const next = Math.min(maximum, Math.max(0, (field === 'chip' ? chip : region) + delta));
    if (field === 'chip') { setChip(next); setRegion(0); } else setRegion(next);
  };
  function setChipIndex(next: number) { setChip(next); setRegion(0); }
  function selectProduct(nextId: string) {
    setProductId(nextId); setWafers([]); setWaferId(''); setDecoded(null); setPreviewError(''); setChip(0); setRegion(0);
  }

  return <section className="wafer-data" aria-label={t("产品 wafer 数据")} aria-busy={busy || productsLoading || wafersLoading || previewLoading}>
    <div className="wafer-heading"><h2>{t("产品 / Wafer")}</h2></div>
    <details className="wafer-product-details" open={!products.length && !productsLoading}><summary>{t("创建产品定义")}</summary><form className="wafer-product-form" onSubmit={createProduct}>
      <label>{t("产品名称")}<input required maxLength={120} value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} /></label>
      {([['chipCount', t("Chip 数 k")], ['regionCount', t("每 Chip Region 数 n")], ['rows', 'Region row'], ['cols', 'Region col']] as const).map(([key, label]) => <label key={key}>{label}<input required min="1" step="1" inputMode="numeric" type="number" value={form[key]} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></label>)}
      <button className="action-button" disabled={busy || productsLoading}><Plus />{t("创建产品")}</button>
    </form></details>
    {!!products.length && <div className="wafer-selector">
      <label>{t("产品")}<select disabled={busy || productsLoading} value={productId} onChange={event => selectProduct(event.target.value)}>{products.map(item => <option value={item.id} key={item.id}>{item.name} · {item.chipCount} × {item.regionCount} · {item.rows} × {item.cols}</option>)}</select></label>
      <label>Wafer<select disabled={busy || wafersLoading} value={waferId} onChange={event => { setWaferId(event.target.value); setDecoded(null); setPreviewError(''); setChip(0); setRegion(0); }}>{!wafers.length && <option value="">{t("暂无 wafer")}</option>}{wafers.map(item => <option value={item.id} key={item.id}>{item.name} · {item.failCount.toLocaleString(getLanguage())} fail{item.synthetic ? t(" · 合成") : ''}</option>)}</select></label>
      {product && <span className="wafer-layout">{product.chipCount.toLocaleString(getLanguage())} chips · {product.regionCount.toLocaleString(getLanguage())} regions/chip · {product.rows.toLocaleString(getLanguage())} × {product.cols.toLocaleString(getLanguage())}</span>}
    </div>}
    {!products.length && !productsLoading && <p className="task-empty">{t("暂无产品。")}</p>}
    {product && <div className="wafer-actions"><input hidden type="file" accept=".pwafer,application/octet-stream" ref={inputRef} onChange={importWafer} /><button className="action-button" disabled={busy || wafersLoading} onClick={() => inputRef.current?.click()}><Plus />{t("导入 .pwafer")}</button>{wafer && <><a className="action-button" href={fileUrl(wafer.file)} download><Download />{t("下载")}</a><span>{wafer.synthetic ? t("合成数据") : t("导入数据")} · {attachedFileIds.has(wafer.fileId) ? t("已关联当前任务") : t("未关联当前任务")}</span>{!attachedFileIds.has(wafer.fileId) && <button className="action-button" disabled={busy} onClick={() => void attachWafer()}>{t("关联到当前任务")}</button>}</>}</div>}
    {product && <WaferGenerator key={product.id} product={product} disabled={busy || wafersLoading} onBusy={setBusy} onSave={async (file, generation) => { try { await storeWafer(file, generation); } catch (err) { setNotice(''); throw err; } }} />}
    {notice && <p className="wafer-notice" role="status">{localizeMessage(notice)}</p>}{error && <p className="workspace-error" role="alert">{localizeMessage(error)}</p>}{previewError && <p className="workspace-error" role="alert">{t("无法读取 wafer 预览：")}{localizeMessage(previewError)}</p>}
    {wafer && product && <div className="wafer-browser">
      {decoded && <WaferHeatmap key={wafer.id} decoded={decoded} selected={chip} onSelect={setChipIndex} />}
      {wafer.generation && <details className="wafer-generation-record"><summary>{t("合成数据 ·") + " "}{t(SPATIAL_PATTERNS.find(item => item.id === wafer.generation?.pattern)?.label ?? wafer.generation.pattern)} {" " + t("· 种子") + " "}{wafer.generation.seed}</summary><p>{t("均值") + " "}{wafer.generation.meanFails / product.regionCount} {" " + t("fail/region · 强度") + " "}{wafer.generation.strength} {" " + t("· 离散") + " "}{wafer.generation.dispersion} {" " + t("· 未使用实测数据拟合")}</p></details>}
      <div className="wafer-summary"><span>{wafer.failCount.toLocaleString(getLanguage())} fail</span><span>{wafer.occupiedRegionCount.toLocaleString(getLanguage())} / {(product.chipCount * product.regionCount).toLocaleString(getLanguage())} {" " + t("非空 region")}</span></div>
      <div className="wafer-indexes">
        <NumberPicker label="Chip" value={chip} maximum={product.chipCount - 1} onChange={setChipIndex} onStep={delta => step('chip', delta)} />
        <NumberPicker label="Region" value={region} maximum={product.regionCount - 1} onChange={setRegion} onStep={delta => step('region', delta)} />
      </div>
      {decoded && <RegionOverview rows={product.rows} cols={product.cols} positions={group?.positions} />}
      <p className="task-note">{t("全局 region #")}{selectedRegionIndex.toLocaleString(getLanguage())} {" " + t("· 0-based 坐标")}{decoded ? ` · ${group?.positions.length ?? 0} fail` : ''}</p>
      <div className="wafer-positions">{previewLoading && <p>{t("正在读取 region 数据…")}</p>}{!previewLoading && previewError && <p>{t("预览不可用")}</p>}{decoded && !group && <p>0 fail</p>}{group && <><p>{t("显示前") + " "}{Math.min(50, group.positions.length)} / {group.positions.length} {" " + t("个 fail：")}</p><ol>{Array.from(group.positions.slice(0, 50), position => <li key={position}>({Math.floor(position / product.cols)}, {position % product.cols})</li>)}</ol></>}</div>
    </div>}
  </section>;
}

function NumberPicker({ label, value, maximum, onChange, onStep }: { label: string; value: number; maximum: number; onChange: (value: number) => void; onStep: (delta: number) => void }) {
  return <label className="wafer-number">{label}<span><button type="button" className="action-button" disabled={value <= 0} onClick={() => onStep(-1)}>{t("上一项")}</button><input min="0" max={maximum} type="number" value={value} onChange={event => onChange(Math.min(maximum, Math.max(0, number(event.target.value))))} /><button type="button" className="action-button" disabled={value >= maximum} onClick={() => onStep(1)}>{t("下一项")}</button></span><small>0–{maximum.toLocaleString(getLanguage())}</small></label>;
}

function RegionOverview({ rows, cols, positions }: { rows: number; cols: number; positions?: Uint32Array }) {
  const transposed = rows > cols;
  const horizontal = transposed ? rows : cols;
  const vertical = transposed ? cols : rows;
  const width = Math.min(128, horizontal);
  const height = Math.max(1, Math.round(vertical * width / horizontal));
  const unit = Math.max(1, Math.floor(128 / Math.max(width, height)));
  const occupied = useMemo(() => {
    const bins = new Set<number>();
    for (const position of positions ?? []) {
      const row = Math.floor(position / cols);
      const col = position % cols;
      const x = transposed ? row : col;
      const y = transposed ? col : row;
      bins.add(Math.floor(y * height / vertical) * width + Math.floor(x * width / horizontal));
    }
    return [...bins];
  }, [positions, cols, transposed, horizontal, vertical, width, height]);
  return <figure className="wafer-overview"><div className="wafer-map-scroll"><svg width={`${width * unit}rem`} height={`${height * unit}rem`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("当前 region 的 {0} row {1} col fail 分布，横轴 {2}，纵轴 {3}", rows, cols, transposed ? 'row' : 'col', transposed ? 'col' : 'row')} shapeRendering="crispEdges">{occupied.map(index => <rect className="wafer-bin-occupied" key={index} x={index % width} y={Math.floor(index / width)} width="1" height="1" />)}</svg></div><figcaption>{t("横轴") + " "}{transposed ? 'row' : 'col'} {" " + t("· 纵轴") + " "}{transposed ? 'col' : 'row'} · {width < horizontal || height < vertical ? t("聚合：{0} × {1}", width, height) : t("逐单元")}</figcaption></figure>;
}
