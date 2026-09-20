import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function readOpenCodeGoKey() {
  const dataRoot = process.env.XDG_DATA_HOME || resolve(homedir(), '.local/share');
  const authFile = process.env.PIXEL_OPENCODE_AUTH_FILE || resolve(dataRoot, 'opencode/auth.json');
  const auth = JSON.parse(readFileSync(authFile, 'utf8'))['opencode-go'];
  if (auth?.type !== 'api' || typeof auth.key !== 'string' || !auth.key.trim() || /[\r\n]/.test(auth.key)) {
    throw new Error('OpenCode Go API credential unavailable');
  }
  return auth.key.trim();
}

export function openCodeGoSession() {
  const conversation = process.env.PIXEL_CONVERSATION_DIR || process.cwd();
  return `pixel-chat-${createHash('sha256').update(conversation).digest('hex').slice(0, 32)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--key') process.stdout.write(readOpenCodeGoKey());
    else if (process.argv[2] === '--session') process.stdout.write(openCodeGoSession());
    else if (process.argv[2] === '--check') {
      readOpenCodeGoKey();
      console.log('OpenCode Go credential is available');
    } else throw new Error('Use --check, --key (Pi internal), or --session');
  } catch {
    // Never include credential file contents or provider headers in errors.
    console.error('Cannot resolve the requested OpenCode Go authentication value');
    process.exitCode = 1;
  }
}
