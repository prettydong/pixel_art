// Sends only a minimal connectivity prompt; never prints the credential or headers.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readOpenCodeGoKey } from './opencode-go-auth.mjs';

const config = JSON.parse(readFileSync(new URL('../backend/models.json', import.meta.url), 'utf8'));
const scratch = mkdtempSync(resolve(tmpdir(), 'pixel-go-check-'));
const secret = readOpenCodeGoKey();
const clean = message => String(message).split(secret).join('[redacted]');
try {
  const modelsPath = resolve(scratch, 'models.json');
  writeFileSync(modelsPath, JSON.stringify({ providers: config.providers }), { mode: 0o600 });
  const runtime = await ModelRuntime.create({ authPath: resolve(scratch, 'auth.json'), modelsPath,
    modelsStorePath: resolve(scratch, 'model-cache.json'), allowModelNetwork: false });
  if (runtime.getError()) throw new Error(runtime.getError());
  for (const entry of config.models) {
    const model = runtime.getModel(entry.provider, entry.model);
    if (!model || !runtime.hasConfiguredAuth(entry.provider)) throw new Error(`Model unavailable: ${entry.model}`);
  }
  console.log(JSON.stringify({ configuredModels: config.models.length, defaultModel: config.models[0].model }));
  const selected = process.argv.slice(2);
  for (const id of (selected.length ? selected : [config.models[0].model])) {
    const model = runtime.getModel('opencode-go', id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    const message = await runtime.completeSimple(model, {
      systemPrompt: 'This is a connectivity check. Reply with only PIXEL_GO_OK.',
      messages: [{ role: 'user', content: 'Reply with exactly PIXEL_GO_OK.', timestamp: Date.now() }],
    }, { maxTokens: 1024, reasoning: 'minimal', signal: AbortSignal.timeout(60000) });
    const reply = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
    if (message.stopReason === 'error' || !reply.includes('PIXEL_GO_OK')) {
      throw new Error(`${id}: ${message.errorMessage || `Unexpected response (${message.stopReason})`}`);
    }
    console.log(JSON.stringify({ model: id, api: model.api, response: 'PIXEL_GO_OK', stopReason: message.stopReason,
      inputTokens: message.usage?.input, outputTokens: message.usage?.output }));
  }
} catch (error) {
  console.error(clean(error.message)); process.exitCode = 1;
} finally {
  // This directory was created above and only contains this check's temporary configuration.
  rmSync(scratch, { recursive: true, force: true });
}
