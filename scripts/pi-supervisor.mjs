// Spawn detached with an IPC channel. Pi and its ordinary descendants inherit
// this process group; IPC closure tells us the owning API process has died.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [cli, ...args] = process.argv.slice(2);
if (!cli || !process.send || !process.connected) {
  console.error('Pi supervisor requires a CLI path and a live parent IPC channel.');
  process.exit(1);
}

let stopping = false;
let child;
const descendants = new Map();
function identity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { start: fields[19], group: Number(fields[2]) };
  } catch { return null; }
}
function rememberDescendants() {
  if (process.platform !== 'linux') return;
  const visited = new Set();
  function visit(pid) {
    if (visited.has(pid)) return;
    visited.add(pid);
    try {
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
      for (const id of children) {
        const found = identity(id);
        if (found) { descendants.set(id, found); visit(id); }
      }
    } catch { /* The process may have exited during the snapshot. */ }
  }
  visit(process.pid);
  for (const [pid, saved] of descendants) {
    if (identity(pid)?.start === saved.start) visit(pid);
    else descendants.delete(pid);
  }
}
function signalGroup(signal) {
  rememberDescendants();
  // Pi's bash tool starts its own detached groups. Cover those as well,
  // including the fallback path when pi itself is too busy to handle TERM.
  for (const [pid, saved] of [...descendants].reverse()) {
    if (identity(pid)?.start !== saved.start) continue;
    try { process.kill(saved.group === pid ? -pid : pid, signal); } catch { /* Exited. */ }
  }
  try { process.kill(-process.pid, signal); }
  catch (error) {
    if (error.code !== 'ESRCH') console.error('Unable to signal Pi process group:', error.code);
    // Fallback is for launch failures; callers must use detached:true on POSIX.
    child?.kill(signal);
    if (signal === 'SIGKILL') process.exit(1);
  }
}

// Remember ordinary detached descendants before they are reparented. This is
// lifecycle cleanup for trusted tools, not a sandbox against daemonization.
const monitor = setInterval(rememberDescendants, 250);
monitor.unref();
function stop() {
  if (stopping) return;
  stopping = true;
  // Do not exit before the deadline: background descendants can outlive pi.
  setTimeout(() => signalGroup('SIGKILL'), 1500);
  signalGroup('SIGTERM');
}

process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGHUP', stop);
process.on('uncaughtException', (error) => {
  console.error('Pi supervisor failed:', error.message);
  stop();
});

if (!stopping) {
  child = spawn(process.execPath, [cli, ...args], {
    cwd: process.cwd(), env: process.env, stdio: ['inherit', 'inherit', 'inherit'],
  });
  child.on('error', (error) => {
    console.error('Could not start Pi:', error.message);
    stop();
  });
  child.on('exit', stop);
}
