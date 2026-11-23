// Run a command up to N times, each attempt with its own time limit, and pass if any attempt passes.
//   node scripts/with-retry.mjs <attempts> <minutes-per-attempt> -- node scripts/e2e-dev.mjs next webkit
// For the browser jobs in CI, where a slow or hung browser on a shared runner is the usual failure. A pass on a later attempt is
// not hidden: it prints a GitHub Actions warning naming the attempt, so a flake shows up on the run and a real intermittent bug
// would too. A hung attempt is killed (with its children) and counted as a failure.
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const [attempts, minutes] = args.slice(0, split).map(Number);
const cmd = args.slice(split + 1);
if (split < 0 || !cmd.length || !(attempts >= 1) || !(minutes > 0)) {
  console.error('Usage: node scripts/with-retry.mjs <attempts> <minutes-per-attempt> -- <command...>');
  process.exit(2);
}
const win = process.platform === 'win32';

const attempt = (n) =>
  new Promise((resolve) => {
    console.log(`::group::attempt ${n} of ${attempts}: ${cmd.join(' ')}`);
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', detached: !win, shell: win && /\.(cmd|bat)$/i.test(cmd[0]) });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`attempt ${n} did not finish in ${minutes} minutes, stopping it`);
      if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else {
        try {
          process.kill(-child.pid, 'SIGKILL'); // the whole group: the dev server and browser it started too
        } catch {
          child.kill('SIGKILL'); // a root-owned child (apt under sudo) can't be signalled by us; stop what we can and move on
        }
      }
    }, minutes * 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      console.log('::endgroup::');
      resolve(timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail');
    });
    child.on('error', () => {
      clearTimeout(timer);
      console.log('::endgroup::');
      resolve('fail');
    });
  });

const results = [];
for (let n = 1; n <= attempts; n++) {
  const r = await attempt(n);
  results.push(r);
  if (r === 'pass') {
    if (n > 1) console.log(`::warning::Passed on attempt ${n} of ${attempts} (earlier attempts: ${results.slice(0, -1).join(', ')}): ${cmd.join(' ')}`);
    process.exit(0);
  }
}
console.error(`::error::Failed all ${attempts} attempts (${results.join(', ')}): ${cmd.join(' ')}`);
process.exit(1);
