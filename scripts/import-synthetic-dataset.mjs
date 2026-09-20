import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const base = process.env.PIXEL_IMPORT_URL ?? 'http://127.0.0.1:20002';
const origin = process.env.PIXEL_IMPORT_ORIGIN ?? 'http://124.223.31.42:12300';
const username = process.env.PIXEL_IMPORT_USER ?? 'admin';
const password = readFileSync(0, 'utf8').trim();
if (!password) throw new Error('Supply login password on stdin');
const directory = resolve('datasets/synthetic-fails-1024x1024-seed20260920');
const name = '1024×1024 模拟失效数据';
const filenames = ['fails.csv', 'roster.csv', 'manifest.json', 'README.md'];
const sha = value => createHash('sha256').update(value).digest('hex');
const contents = new Map(filenames.map(filename => [filename, readFileSync(join(directory, filename))]));
const manifest = JSON.parse(contents.get('manifest.json').toString());
for (const filename of ['fails.csv', 'roster.csv']) {
  if (sha(contents.get(filename)) !== manifest.files[filename].sha256) throw new Error('Dataset fingerprint mismatch');
}
let cookie = '';
async function request(path, method = 'GET', body) {
  const headers = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}/api${path}`, {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Import request failed: ${method} ${path} (${response.status})`);
  return response;
}
try {
  const login = await request('/auth/login', 'POST', { username, password });
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Login cookie missing');
  const tasks = await (await request('/tasks')).json();
  const matching = tasks.items.filter(task => task.name === name);
  if (matching.length > 1) throw new Error('Multiple matching tasks; refusing ambiguous import');
  const task = matching[0] ?? await (await request('/tasks', 'POST', { name })).json();
  const detail = await (await request(`/tasks/${task.id}`)).json();
  for (const filename of filenames) {
    const existing = detail.files.filter(file => file.kind === 'upload' && file.name === filename);
    if (existing.length > 1) throw new Error(`Multiple matching files: ${filename}`);
    const bytes = contents.get(filename);
    if (existing.length) {
      const response = await request(`/uploads/${existing[0].id}`);
      if (sha(Buffer.from(await response.arrayBuffer())) !== sha(bytes)) throw new Error(`Existing file differs: ${filename}`);
      continue;
    }
    const form = new FormData();
    form.append('file', new Blob([bytes]), filename);
    const uploaded = await (await request('/uploads', 'POST', form)).json();
    await request(`/tasks/${task.id}/files`, 'POST', { fileId: uploaded.id });
    const downloaded = await request(`/uploads/${uploaded.id}`);
    if (sha(Buffer.from(await downloaded.arrayBuffer())) !== sha(bytes)) throw new Error(`Uploaded fingerprint mismatch: ${filename}`);
  }
  const result = await (await request(`/tasks/${task.id}`)).json();
  console.log(JSON.stringify({ taskId: task.id, taskName: result.name, files: result.files.map(file => ({ id: file.id, name: file.name, size: file.size })), samples: manifest.samples, fail_count: manifest.fail_count, checksumVerified: true }, null, 2));
} finally {
  if (cookie) await request('/auth/logout', 'POST');
}
