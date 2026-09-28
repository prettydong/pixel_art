// The backend spawns this process as a new process-group leader with an IPC channel.
// Keep the compiler/solver in this group so a backend crash also stops its writers.
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command || !process.connected) {
  process.stderr.write('repair-supervisor requires a command and a backend IPC channel\n');
  process.exit(1);
}
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], detached: false });
let finished = false;
function killGroup() {
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { /* already gone */ }
  } else {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}
process.on('disconnect', killGroup);
child.on('error', error => {
  if (finished) return;
  finished = true;
  process.stderr.write(`Cannot start ${command}: ${error.message}\n`);
  process.exitCode = 1;
  process.disconnect();
});
child.on('exit', (code, signal) => {
  if (finished) return;
  finished = true;
  // Exit lets the backend finish its bounded log drain and kill any descendants.
  process.exit(signal ? 1 : code ?? 1);
});
