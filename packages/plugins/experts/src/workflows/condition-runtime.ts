import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { packagePath, type WorkflowCondition } from './authoring.js';
import { compareCondition, validateCondition } from './conditions.js';

/** A condition reads only an authorized workspace file; no script or expression execution. */
export async function evaluateCondition(value: WorkflowCondition, cwd: string, signal: AbortSignal) {
  validateCondition(value); signal.throwIfAborted();
  if (value.source === 'literal') return { decision: compareCondition(value, value.input) };
  const root = await realpath(cwd), path = packagePath(value.input);
  let target = root;
  for (const part of path.split('/')) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error('条件文件路径不能包含链接。');
  }
  const actual = await realpath(target), rel = relative(root, actual);
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new Error('条件文件超出授权工作区。');
  const info = await lstat(actual);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('条件输入必须是至多 1 MiB 的文本文件。');
  const bytes = await readFile(actual, { signal });
  if (bytes.length > 1024 * 1024) throw new Error('条件文件读取期间超出 1 MiB 限制。');
  if (bytes.includes(0)) throw new Error('条件输入必须是 UTF-8 文本。');
  const input = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { decision: compareCondition(value, input), files: { [path]: createHash('sha256').update(bytes).digest('hex') } };
}
