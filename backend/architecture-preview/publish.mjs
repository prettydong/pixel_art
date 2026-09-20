import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, lstatSync, copyFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArchitectureScene } from '../../packages/contracts/architecture-scene.js';

// This harness validates and archives the agent's drawing. It never decides layout or draws pixels.
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`缺少 ${name}`); return args[i + 1]; };
const sha = data => createHash('sha256').update(data).digest('hex');
try {
  const work = realpathSync(process.env.PIXEL_WORK_DIR);
  const artifacts = realpathSync(resolve(work, 'artifacts'));
  const safeInput = value => {
    const path = realpathSync(resolve(value)); const rel = relative(work, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep) || !statSync(path).isFile() || statSync(path).size > 1000000) throw new Error('输入必须是当前work内不超过1MB的文件');
    return path;
  };
  const input = safeInput(option('--scene'));
  const recipe = safeInput(option('--recipe'));
  if (!/\.(py|js|mjs)$/.test(recipe)) throw new Error('保留生成绘图描述的Python或JavaScript脚本');
  const scene = validateArchitectureScene(JSON.parse(readFileSync(input, 'utf8')));
  const draw = scene.draw ? safeInput(option('--draw')) : undefined;
  const context = JSON.parse(readFileSync(safeInput(process.env.PIXEL_TASK_CONTEXT), 'utf8'));
  const architecture = context.architectures.find(item => item.id === scene.architectureId);
  if (!architecture || architecture.fingerprint !== scene.fingerprint) throw new Error('架构ID或指纹与本轮任务上下文不匹配');
  const css = readFileSync(fileURLToPath(new URL('../../fronted/src/styles.css', import.meta.url)), 'utf8');
  const dark = css.match(/:root \{([\s\S]*?)\n\}/)?.[1];
  const light = css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)?.[1];
  const themeSnapshot = {};
  for (const token of new Set(Object.values(scene.palette))) {
    const color = block => block?.match(new RegExp(`${token}:\\s*(#[a-fA-F0-9]{6});`))?.[1];
    const colors = { light: color(light), dark: color(dark) };
    if (!colors.light || !colors.dark) throw new Error(`主题颜色缺失：${token}`);
    themeSnapshot[token] = colors;
  }
  const output = resolve(artifacts, `architecture-preview-${randomUUID()}`);
  mkdirSync(output, { mode: 0o700 });
  if (lstatSync(output).isSymbolicLink()) throw new Error('输出目录不可为软链接');
  const bytes = JSON.stringify(scene, null, 2) + '\n';
  const recipeName = `recipe${recipe.endsWith('.py') ? '.py' : '.mjs'}`;
  writeFileSync(resolve(output, 'scene.json'), bytes, { flag: 'wx', mode: 0o600 });
  copyFileSync(recipe, resolve(output, recipeName));
  if (draw) copyFileSync(draw, resolve(output, 'draw.mjs'));
  const manifest = { draw: draw ? { name: 'draw.mjs', sha256: sha(readFileSync(draw)) } : undefined, protocol: 'pixel-architecture-preview/v1', architectureId: scene.architectureId, fingerprint: scene.fingerprint,
    taskId: context.task.id, runId: process.env.PIXEL_RUN_ID, createdAt: Date.now(),
    scene: { name: 'scene.json', sha256: sha(bytes) }, recipe: { name: recipeName, sha256: sha(readFileSync(recipe)) }, themeSnapshot,
    checks: ['schema', 'architecture-fingerprint', 'integer-grid', 'bounds', 'palette', 'unique-node-ids', 'complexity'] };
  // Written last: partial folders never become published previews.
  writeFileSync(resolve(output, 'architecture-preview.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'published', output, canvas: scene.canvas, nodes: scene.nodes.length, manifest }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
