import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { apply as applyOfficial } from '@deepseek-ai/dsh-tool-pwsh';

export { Config, inject, name } from '@deepseek-ai/dsh-tool-pwsh';

const probes = new Map();

function probe(executable) {
  return new Promise(resolve => {
    // A fixed, read-only startup check; never execute or retry a model command here.
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      (error, stdout, stderr) => resolve({ ok: !error && !!stdout.trim(), stderr }));
  });
}

async function compatiblePath(executable) {
  if (process.platform !== 'win32' || typeof executable !== 'string') return executable;
  if (!probes.has(executable)) probes.set(executable, (async () => {
    const original = await probe(executable);
    if (original.ok || !original.stderr.includes("Your Windows doesn't fully support CET")) return executable;
    const fallback = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fallback.toLowerCase() === executable.toLowerCase() || !(await probe(fallback)).ok) return executable;
    return fallback;
  })());
  return probes.get(executable);
}

export async function apply(ctx, config) {
  const original = ctx.shell.pwshPath;
  const compatible = await compatiblePath(original);
  if (compatible === original) return applyOfficial(ctx, config);
  ctx.logger.warn('WorkDSH workflow: PowerShell CET startup failed; using validated Windows PowerShell for this tool.');
  // Delegate resolve/execute to the mounted executor, including its sandbox and approval path.
  // Do not change global shell settings or Windows security protections.
  const shell = new Proxy(ctx.shell, {
    get(target, key, receiver) {
      if (key === 'pwshPath') return target.pwshPath === original ? compatible : target.pwshPath;
      return Reflect.get(target, key, receiver);
    },
  });
  const scoped = new Proxy(ctx, {
    get(target, key) {
      if (key === 'shell') return shell;
      return Reflect.get(target, key, target);
    },
  });
  applyOfficial(scoped, config);
  ctx.systemPrompt.section({
    name: 'workdsh:pwsh-compatibility',
    order: ctx.systemPrompt.getSectionOrder('TOOL_PWSH'),
    text: 'PowerShell runtime: Windows PowerShell 5.1 is active because PowerShell 7 failed its CET startup check. Use compatible commands; the mounted sandbox and approval policy still apply.',
  });
}
