import { localizeMessage, getLanguage, t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { ProductRecord } from '@pixel/contracts/wafer-data';
import { DEFAULT_FAILS_PER_REGION, DEFAULT_GENERATION, MAX_MAP_CHIPS, SPATIAL_PATTERNS, validateGenerationOptions, type GenerationMetadata } from '@pixel/contracts/wafer-spatial';
import { errorText } from './api';

type Result = { bytes: Uint8Array<ArrayBuffer>; generation: GenerationMetadata; error?: string };
type Props = { product: ProductRecord; disabled: boolean; onBusy: (busy: boolean) => void; onSave: (file: File, generation: GenerationMetadata) => Promise<void> };
export function WaferGenerator({ product, disabled, onBusy, onSave }: Props) {
  const [name, setName] = useState('');
  const [form, setForm] = useState({ pattern: DEFAULT_GENERATION.pattern, seed: String(DEFAULT_GENERATION.seed), meanFailsPerRegion: String(DEFAULT_FAILS_PER_REGION), strength: String(DEFAULT_GENERATION.strength), dispersion: String(DEFAULT_GENERATION.dispersion) });
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [error, setError] = useState('');
  const current = useRef<{ worker: Worker; reject: (error: Error) => void } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.worker.terminate(); current.current?.reject(new Error(t("生成已取消"))); current.current = null; };
  }, []);
  async function generate(event: React.FormEvent) {
    event.preventDefault(); if (disabled || phase !== 'idle') return;
    setError('');
    try {
      const options = validateGenerationOptions({ pattern: form.pattern, seed: Number(form.seed), meanFails: Number(form.meanFailsPerRegion) * product.regionCount, strength: Number(form.strength), dispersion: Number(form.dispersion) });
      setPhase('generating'); onBusy(true);
      const result = await new Promise<Result>((resolve, reject) => {
        const worker = new Worker(new URL('./waferGenerator.worker.ts', import.meta.url), { type: 'module' });
        current.current = { worker, reject };
        worker.onmessage = (message: MessageEvent<Result>) => { if (message.data.error) reject(new Error(message.data.error)); else resolve(message.data); };
        worker.onerror = () => reject(new Error(t("生成器无法启动或执行失败")));
        worker.postMessage({ layout: product, options });
      });
      current.current?.worker.terminate(); current.current = null;
      if (!mounted.current) return;
      setPhase('saving');
      const label = (name.trim() || `${product.name}-${options.pattern}-${options.seed}`).slice(0, 110);
      await onSave(new File([result.bytes], `${label}.pwafer`, { type: 'application/octet-stream' }), result.generation);
    } catch (err) { if (mounted.current) setError(errorText(err)); }
    finally { current.current?.worker.terminate(); current.current = null; if (mounted.current) { setPhase('idle'); onBusy(false); } }
  }
  const field = (key: 'seed' | 'meanFailsPerRegion' | 'strength' | 'dispersion', label: string, min: number, max: number, step: number) => <label>{label}<input required type="number" min={min} max={max} step={step} value={form[key]} disabled={phase !== 'idle'} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></label>;
  return <details className="wafer-generator"><summary>{t("生成合成 Wafer")}</summary>
    <form onSubmit={generate}>
      <div className="wafer-generation-fields"><label>{t("Wafer 名称")}<input placeholder={t("自动命名")} maxLength={110} value={name} disabled={phase !== 'idle'} onChange={event => setName(event.target.value)} /></label>
        <label>{t("空间模式")}<select value={form.pattern} disabled={phase !== 'idle'} onChange={event => setForm(value => ({ ...value, pattern: event.target.value as typeof value.pattern }))}>{SPATIAL_PATTERNS.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>
        {field('seed', t("随机种子"), 0, 4294967295, 1)}{field('meanFailsPerRegion', t("目标平均 fail / region"), 0, 5000000 / (product.chipCount * product.regionCount), 1)}
        <button type="submit" className="action-button" disabled={disabled || phase !== 'idle' || product.chipCount > MAX_MAP_CHIPS}>{phase === 'generating' ? t("正在生成…") : phase === 'saving' ? t("正在保存…") : t("生成并保存")}</button>
        {phase === 'generating' && <button type="button" className="action-button" onClick={() => { current.current?.worker.terminate(); current.current?.reject(new Error(t("已取消生成"))); }}>{t("取消生成")}</button>}
      </div>
      <details><summary>{t("分布参数")}</summary><div className="wafer-generation-fields">{field('strength', t("空间聚集强度"), 0, 30, 0.1)}{field('dispersion', t("离散参数"), 0.2, 100, 0.1)}</div></details>
      {product.chipCount > MAX_MAP_CHIPS && <p className="error-text">{t("页面生成最多支持") + " "}{MAX_MAP_CHIPS.toLocaleString(getLanguage())} {" " + t("个 chip。")}</p>}
      {error && <p className="workspace-error" role="alert">{localizeMessage(error)}</p>}
    </form>
  </details>;
}
