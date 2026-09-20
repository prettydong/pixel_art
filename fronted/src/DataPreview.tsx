import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileRecord } from '@pixel/contracts';
import { fileUrl } from './api';
import './DataPreview.css';

const BYTE_LIMIT = 3 * 1024 * 1024;
const ROW_LIMIT = 50_000;
const COLUMN_LIMIT = 256;
const EXPECTED_FAILS = ['group', 'sample_id', 'row', 'col', 'data_kind'];
const EXPECTED_ROSTER = ['group', 'sample_id', 'fail_count', 'data_kind'];
type Csv = { headers: string[]; rows: string[][]; total: number };
type Manifest = { data_kind?: unknown; array?: { rows?: unknown; cols?: unknown; coordinate_base?: unknown }; samples?: unknown; zero_fail_samples?: unknown; fail_count?: unknown };
type Synthetic = { manifest: Manifest; roster: Csv; fails: Csv; selected: string; errors: string[] };
const sampleKey = (group: string, sample: string) => JSON.stringify([group, sample]);

function parseCsv(text: string): Csv {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) { if (char === '"') { if (text[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; quoteClosed = true; } } else field += char; continue; }
    if (quoteClosed && char !== ',' && char !== '\r' && char !== '\n') throw new Error('CSV 引号结束后包含非法字符');
    if (char === '"') { if (field === '') { quoted = true; continue; } throw new Error('CSV 非引号字段中包含引号'); }
    if (char === ',') { row.push(field); if (row.length >= COLUMN_LIMIT) throw new Error(`CSV 超过 ${COLUMN_LIMIT} 列预览上限`); field = ''; quoteClosed = false; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); if (row.some(value => value !== '')) rows.push(row); row = []; field = ''; quoteClosed = false; if (rows.length > ROW_LIMIT + 1) throw new Error(`CSV 超过 ${ROW_LIMIT.toLocaleString()} 行上限`); continue; }
    field += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (field !== '' || row.length) { row.push(field); rows.push(row); if (rows.length > ROW_LIMIT + 1) throw new Error(`CSV 超过 ${ROW_LIMIT.toLocaleString()} 行上限`); }
  if (!rows.length) return { headers: [], rows: [], total: 0 };
  const [headers, ...body] = rows;
  headers[0] = headers[0].replace(/^\uFEFF/, '');
  if (headers.length > COLUMN_LIMIT) throw new Error(`CSV 超过 ${COLUMN_LIMIT} 列预览上限`);
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('CSV 表头不能为空或重复');
  if (body.some(values => values.length !== headers.length)) throw new Error('CSV 列数不一致');
  return { headers, rows: body, total: body.length };
}
function numberValue(value: string): number | null { const result = /^\d+$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(result) ? result : null; }
function sameHeaders(actual: string[], expected: string[]) { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function find(files: FileRecord[], name: string) { return files.find(file => file.name.toLowerCase() === name); }
function manifestCount(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }

function validateSynthetic(manifest: Manifest, roster: Csv, fails: Csv, selected: string): Synthetic {
  const errors: string[] = [];
  const sampleCount = manifestCount(manifest.samples); const declaredFails = manifestCount(manifest.fail_count); const zeroCount = manifestCount(manifest.zero_fail_samples);
  const validManifest = manifest.data_kind === 'synthetic' && manifest.array?.rows === 1024 && manifest.array?.cols === 1024 && manifest.array?.coordinate_base === 0 && sampleCount !== null && declaredFails !== null && zeroCount !== null;
  if (!validManifest) errors.push('manifest 的 synthetic / 1024 × 1024 / 0 基坐标声明不完整。');
  if (!sameHeaders(roster.headers, EXPECTED_ROSTER)) errors.push('roster.csv 表头不匹配。');
  if (!sameHeaders(fails.headers, EXPECTED_FAILS)) errors.push('fails.csv 表头不匹配。');
  const rosterIds = new Set<string>(); let rosterFails = 0; let zeros = 0;
  roster.rows.forEach(row => { const count = numberValue(row[2]); const id = sampleKey(row[0], row[1]); if (!row[0] || !row[1] || row[3] !== 'synthetic' || count === null || rosterIds.has(id)) errors.push('roster.csv 含无效或重复的组/样本。'); rosterIds.add(id); rosterFails += count ?? 0; if (count === 0) zeros += 1; });
  if (roster.total !== sampleCount || rosterIds.size !== sampleCount) errors.push('roster.csv 样本数与 manifest 不一致。');
  if (rosterFails !== declaredFails || zeros !== zeroCount) errors.push('roster 汇总与 manifest 计数不一致。');
  const failCounts = new Map<string, number>();
  const coordinates = new Set<string>();
  fails.rows.forEach(row => { const r = numberValue(row[2]); const c = numberValue(row[3]); const id = sampleKey(row[0], row[1]); const coordinate = JSON.stringify([id, r, c]); if (!row[0] || !row[1] || row[4] !== 'synthetic' || !rosterIds.has(id) || r === null || c === null || r > 1023 || c > 1023 || coordinates.has(coordinate)) errors.push('fails.csv 含无效、重复坐标或不匹配的组/样本。'); coordinates.add(coordinate); failCounts.set(id, (failCounts.get(id) ?? 0) + 1); });
  if (fails.total !== declaredFails) errors.push('fails.csv 行数与声明的失效数不一致。');
  roster.rows.forEach(row => { if ((failCounts.get(sampleKey(row[0], row[1])) ?? 0) !== numberValue(row[2])) errors.push('每个样本的失效计数不一致。'); });
  return { manifest, roster, fails, selected, errors: [...new Set(errors)] };
}

function FailMap({ data }: { data: Synthetic }) {
  const bins = useMemo(() => { const result = new Uint16Array(128 * 128); data.fails.rows.forEach(row => { if (sampleKey(row[0], row[1]) === data.selected) result[Math.floor(Number(row[2]) / 8) * 128 + Math.floor(Number(row[3]) / 8)] += 1; }); return result; }, [data]);
  return <figure className="data-fail-map"><svg viewBox="0 0 128 128" role="img" aria-label={`${data.selected} 的 1024 × 1024 失效分布图`} shapeRendering="crispEdges">{[...bins].map((count, index) => count ? <rect key={index} x={index % 128} y={Math.floor(index / 128)} width="1" height="1" opacity={count === 1 ? 0.45 : count <= 4 ? 0.65 : count <= 16 ? 0.85 : 1}><title>{`行 ${Math.floor(index / 128) * 8}–${Math.floor(index / 128) * 8 + 7}，列 ${(index % 128) * 8}–${(index % 128) * 8 + 7}：${count} 个 fail`}</title></rect> : null)}</svg><figcaption>横轴为列、纵轴为行，左上角 (0, 0)，右下角 (1023, 1023)。每格合并 8 × 8 单元，并非单个坏点；色阶由浅至深表示 1、2–4、5–16、17–64 个 fail。</figcaption></figure>;
}

export function DataPreview({ taskId, files }: { taskId: string; files: FileRecord[] }) {
  const manifestFile = find(files, 'manifest.json'); const rosterFile = find(files, 'roster.csv'); const failsFile = find(files, 'fails.csv');
  const choices = files.filter(file => /\.csv$/i.test(file.name) || file.id === manifestFile?.id);
  const fileSignature = files.map(file => `${file.id}:${file.size}:${file.name}`).join('|');
  const defaultId = manifestFile?.id ?? choices[0]?.id ?? '';
  const [chosen, setChosen] = useState(manifestFile?.id ?? choices[0]?.id ?? ''); const [csv, setCsv] = useState<Csv | null>(null); const [synthetic, setSynthetic] = useState<Synthetic | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const abort = useRef<AbortController | null>(null);
  useEffect(() => { setChosen(current => choices.some(file => file.id === current) ? current : defaultId); }, [taskId, fileSignature, defaultId]);
  useEffect(() => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setCsv(null); setSynthetic(null); setError('');
    const selected = files.find(file => file.id === chosen); if (!selected) { setLoading(false); return () => controller.abort(); } setLoading(true);
    const read = async (file: FileRecord) => {
      if (file.size > BYTE_LIMIT) throw new Error(`${file.name} 超过 3 MB 预览上限`);
      const response = await fetch(fileUrl(file), { credentials: 'same-origin', signal: controller.signal }); if (!response.ok) throw new Error(`读取 ${file.name} 失败（${response.status}）`);
      const size = Number(response.headers.get('content-length')); if (Number.isFinite(size) && size > BYTE_LIMIT) throw new Error(`${file.name} 超过 3 MB 预览上限`);
      if (!response.body) throw new Error(`无法流式读取 ${file.name}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); const parts: string[] = []; let received = 0;
      while (true) { const chunk = await reader.read(); if (chunk.done) break; received += chunk.value.byteLength; if (received > BYTE_LIMIT) { await reader.cancel(); throw new Error(`${file.name} 超过 3 MB 预览上限`); } parts.push(decoder.decode(chunk.value, { stream: true })); }
      parts.push(decoder.decode()); return parts.join('');
    };
    void (async () => { try { if (selected.id === manifestFile?.id && manifestFile && rosterFile && failsFile) { const [manifestText, rosterText, failsText] = await Promise.all([read(manifestFile), read(rosterFile), read(failsFile)]); if (controller.signal.aborted) return; const manifest = JSON.parse(manifestText) as Manifest; const roster = parseCsv(rosterText); const fails = parseCsv(failsText); const interesting = roster.rows.find(row => row[0] === 'mixed' && Number(row[2]) > 0) ?? roster.rows.find(row => Number(row[2]) > 0) ?? roster.rows[0]; if (!controller.signal.aborted) setSynthetic(validateSynthetic(manifest, roster, fails, interesting ? sampleKey(interesting[0], interesting[1]) : '')); } else if (/\.csv$/i.test(selected.name)) { const result = parseCsv(await read(selected)); if (!controller.signal.aborted) setCsv(result); } else throw new Error('数据集预览需要同时关联 manifest.json、roster.csv 和 fails.csv。'); } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '预览读取失败'); } finally { if (!controller.signal.aborted) setLoading(false); } })();
    return () => controller.abort();
  }, [chosen, fileSignature, manifestFile?.id, rosterFile?.id, failsFile?.id]);
  return <section className="data-preview" aria-label="数据预览" aria-busy={loading}><div className="data-preview-heading"><h2>数据预览</h2>{choices.length > 0 && <label>文件<select value={chosen} onChange={event => setChosen(event.target.value)}>{choices.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>}</div>{loading && <p role="status">正在读取预览…</p>}{error && <p className="workspace-error" role="alert">{error}</p>}{synthetic && <SyntheticPreview data={synthetic} setSelected={sample => setSynthetic({ ...synthetic, selected: sample })} />}{csv && <CsvPreview csv={csv} />}{!loading && !error && !synthetic && !csv && <p className="task-note">此文件可以下载；仅 CSV 提供表格预览。</p>}</section>;
}
function SyntheticPreview({ data, setSelected }: { data: Synthetic; setSelected: (value: string) => void }) { const selectedRow = data.roster.rows.find(row => sampleKey(row[0], row[1]) === data.selected); const valid = !data.errors.length; return <>{valid && <p className="data-summary">模拟数据（synthetic） · {data.roster.total} 个样本（含 {data.roster.rows.filter(row => numberValue(row[2]) === 0).length} 个零失效样本）· {data.fails.total.toLocaleString()} 个失效 · {String(data.manifest.array?.rows)} × {String(data.manifest.array?.cols)}</p>}{!valid ? <p className="workspace-error" role="alert">数据集校验未通过：{data.errors.join(' ')}</p> : <><label className="data-sample">样本<select value={data.selected} onChange={event => setSelected(event.target.value)}>{data.roster.rows.map(row => <option key={sampleKey(row[0], row[1])} value={sampleKey(row[0], row[1])}>{row[0]} / {row[1]} · {row[2]} fails</option>)}</select></label><p className="task-note">{selectedRow?.[0]} / {selectedRow?.[1]}：{selectedRow?.[2] ?? 0} 个失效。此图仅展示输入数据，不代表修补结果。</p><FailMap data={data} /></>}<details><summary>CSV 表格预览</summary><CsvPreview csv={data.roster} /></details></>; }
function CsvPreview({ csv }: { csv: Csv }) { return <div className="data-table-wrap"><p className="task-note">共 {csv.total.toLocaleString()} 行，显示前 {Math.min(50, csv.total)} 行。</p><table className="data-table"><thead><tr>{csv.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{csv.rows.slice(0, 50).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>; }
