import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { packagePath, type AppGenGate } from './authoring.js';

export interface AppGenGateReceipt {
  kind: 'app-gen'; step: number; contextDigest: string;
  specDigest?: string; stateDigest?: string;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function workspaceFile(cwd: string, path: string) {
  const root = await realpath(cwd), portable = packagePath(path);
  let target = root;
  for (const part of portable.split('/')) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error('app-gen 门禁不接受链接路径。');
  }
  const actual = await realpath(target), rel = relative(root, actual), info = await stat(actual);
  if (rel === '..' || rel.startsWith('..' + sep) || !info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('app-gen 控制文件必须位于当前工作区且不超过 4 MiB。');
  return {path: actual, bytes: await readFile(actual)};
}
const object = (bytes: Buffer) => {
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('app-gen 控制文件必须是 JSON 对象。');
  return value;
};

/** Only the frozen app-gen Skill validator runs; the manifest cannot supply a shell command. */
async function validatePipeline(script: string, state: string, cwd: string, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((done, fail) => {
    const child = spawn(process.env.APP_GEN_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [script, 'validate', '--state', state], {
      cwd, shell: false, windowsHide: true,
      env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', APP_GEN_NODE: process.execPath},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      error ? fail(error) : done();
    };
    const abort = () => { child.kill(); finish(new Error('app-gen 门禁已取消。')); };
    const timer = setTimeout(() => {child.kill();finish(new Error('app-gen 状态机校验超时。'));}, 30000);
    const collect = (chunk: Buffer) => { output += chunk.toString('utf8'); if (Buffer.byteLength(output) > 1024 * 1024) {child.kill();finish(new Error('app-gen 校验输出超过限制。'));} };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => finish(new Error('无法运行 Python；app-gen 阶段保持阻断。请配置 Host 的 APP_GEN_PYTHON。')));
    child.on('close', code => finish(code === 0 ? undefined : new Error('app-gen 状态机/证据校验失败：' + output.trim().slice(-2000))));
    signal.addEventListener('abort', abort, {once:true}); if (signal.aborted) abort();
  });
}

/** validate exit 0 can mean 0/9: require every step through this node to be passed as well. */
export async function checkAppGenGate(cwd: string, gate: AppGenGate, skillDirectory: string | undefined, signal: AbortSignal): Promise<AppGenGateReceipt> {
  signal.throwIfAborted();
  const contextFile = await workspaceFile(cwd, gate.context), context = object(contextFile.bytes), target = context.targetConfirmation;
  if (context.version !== 1 || !target || target.confirmed !== true || !['dry-run','apply'].includes(context.executionMode)
    || typeof target.appId !== 'string' || !target.appId.trim() || typeof target.databaseName !== 'string' || !target.databaseName.trim()
    || typeof context.dataSource !== 'string' || !context.dataSource.trim() || typeof context.appKey !== 'string' || !context.appKey.trim()
    || !['user','environment-readback'].includes(target.source) || !Array.isArray(target.evidenceRefs) || !target.evidenceRefs.length) {
    throw new Error('Gate 0 未通过：需确认真实 appId、databaseName、dataSource、执行模式及来源证据。');
  }
  packagePath(context.spec); packagePath(context.state);
  for (const ref of target.evidenceRefs) {
    if (!ref || typeof ref.path !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '') || digest((await workspaceFile(cwd,ref.path)).bytes) !== ref.sha256) throw new Error('Gate 0 来源证据缺失或哈希不一致。');
  }
  const receipt: AppGenGateReceipt = {kind:'app-gen',step:gate.step,contextDigest:digest(contextFile.bytes)};
  if (gate.step === 0) return receipt;
  if (!skillDirectory) throw new Error('阶段未绑定可冻结的 app-gen Skill。');
  const specFile = await workspaceFile(cwd, context.spec), stateFile = await workspaceFile(cwd, context.state);
  const spec = object(specFile.bytes), state = object(stateFile.bytes), app = spec.app, confirmation = spec.targetConfirmation;
  if (!app || !confirmation || confirmation.confirmed !== true || app.appId !== target.appId || confirmation.appId !== target.appId
    || app.databaseName !== target.databaseName || confirmation.databaseName !== target.databaseName
    || app.dataSource !== context.dataSource || app.appKey !== context.appKey || app.executionMode !== context.executionMode) throw new Error('规格目标与已确认的 Gate 0 不一致。');
  const specPath = isAbsolute(state.specPath ?? '') ? resolve(state.specPath) : resolve(cwd, state.specPath ?? '');
  if (specPath !== resolve(specFile.path) || state.specSha256 !== digest(specFile.bytes)) throw new Error('app-gen 规格路径或 SHA-256 不一致，必须重基线。');
  if (!Array.isArray(state.steps) || state.steps.length !== 9 || state.steps.slice(0,gate.step).some((s: any,i: number) => s.number !== i+1 || s.status !== 'passed')) {
    throw new Error('app-gen Step ' + gate.step + ' 及其前置步骤尚未全部 passed。');
  }
  const skillRoot = await realpath(skillDirectory), script = join(skillRoot, 'scripts', 'pipeline_state.py');
  if ((await lstat(script)).isSymbolicLink() || relative(skillRoot, await realpath(script)).startsWith('..')) throw new Error('app-gen 校验器必须来自固定 Skill 快照。');
  await validatePipeline(script, stateFile.path, cwd, signal);
  signal.throwIfAborted();
  // A concurrent edit cannot reuse the validator's old success.
  if (digest(await readFile(contextFile.path)) !== receipt.contextDigest || digest(await readFile(specFile.path)) !== digest(specFile.bytes)
    || digest(await readFile(stateFile.path)) !== digest(stateFile.bytes)) throw new Error('app-gen 校验期间控制文件发生变化，请重新检查。');
  return {...receipt, specDigest:digest(specFile.bytes),stateDigest:digest(stateFile.bytes)};
}
