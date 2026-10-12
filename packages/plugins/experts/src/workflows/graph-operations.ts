import { presetDocument, validateStages, type WorkflowManifest, type WorkflowStage } from './authoring.js';

export type Port = 'next' | 'whenTrue' | 'whenFalse';
export interface GraphEdge { from: string; port: Port; target: string }
export type GraphOperation =
  | { type: 'insert'; id: string; kind: WorkflowStage['kind']; target?: string; from?: string; port?: Port; all?: boolean; copy?: string }
  | { type: 'delete'; id: string; keep?: Port; replacement?: string }
  | { type: 'move'; id: string; from: string; port: Port }
  | { type: 'connect'; from: string; port: Port; target: string }
  | { type: 'convert'; id: string; kind: WorkflowStage['kind']; keep?: Port };
export function graphEdges(manifest: Pick<WorkflowManifest, 'stages'>): GraphEdge[] {
  return (manifest.stages ?? []).flatMap(n => (n.kind === 'end' ? [] : n.kind === 'branch' ? ['whenTrue', 'whenFalse'] : ['next'])
    .map(port => ({ from: n.id, port: port as Port, target: n[port as Port] ?? '' })));
}
/** Only predecessor outputs can be suggested as stage inputs. */
export function upstreamOutputs(manifest: Pick<WorkflowManifest, 'stages'>, id: string): string[] {
  const edges = graphEdges(manifest), ancestors = new Set<string>();
  const visit = (target: string) => {
    for (const edge of edges.filter(e => e.target === target)) if (edge.from !== id && !ancestors.has(edge.from)) {
      ancestors.add(edge.from); visit(edge.from);
    }
  };
  visit(id);
  return [...new Set((manifest.stages ?? []).filter(n => ancestors.has(n.id)).flatMap(n => n.outputs ?? []))];
}
export const stageLabels = { task: 'Agent 任务', approval: '人工确认', check: '产出校验', branch: '文件条件', end: '结束' };
export function newStage(id: string, kind: WorkflowStage['kind'], next?: string): WorkflowStage {
  return { id, name: stageLabels[kind], kind,
    ...(kind === 'task' ? { prompt: '', inputs: [] } : {}),
    ...(['task', 'check'].includes(kind) ? { outputs: ['generated/' + id + '/result.md'] } : {}),
    ...(kind === 'branch' ? { file: 'generated/condition/result.md', whenTrue: next, whenFalse: next } : kind === 'end' ? {} : { next }) };
}
/** Structural validation permits unfinished task text while editing, not while publishing. */
export function validateGraph(manifest: WorkflowManifest) {
  validateStages({ ...manifest, stages: manifest.stages?.map(n => ({ ...n, execution: undefined, inputs: [], outputs: ['draft-output.md'], file: 'draft-condition.md', prompt: 'Draft task' })) });
}
/** One AST transaction; preserve retained node objects/comments and unknown fields. */
export function applyGraphOperation(text: string, operation: GraphOperation): { text: string; selected?: string; removed: string[] } {
  const doc = presetDocument(text); if (doc.errors.length) throw new Error('请先修复 YAML 语法。');
  const manifest = doc.toJS({ maxAliasCount: 0 }) as WorkflowManifest;
  const nodes = manifest.stages ?? [], map = new Map(nodes.map(n => [n.id, n]));
  const originalSequence = doc.getIn(['stages'], true) as any;
  const ast = new Map(nodes.map((n, i) => [n.id, originalSequence.items[i]]));
  const removed: string[] = [];
  const node = (id: string) => { const n = map.get(id); if (!n) throw new Error('阶段不存在：' + id); return n; };
  const set = (n: WorkflowStage, field: string, value: unknown) => { (n as any)[field] = value; ast.get(n.id)?.set(field, value); };
  const erase = (id: string) => { const i = nodes.findIndex(n => n.id === id); if (i >= 0) nodes.splice(i, 1); map.delete(id); removed.push(id); };
  const rewire = (old: string, target: string) => { for (const edge of graphEdges(manifest).filter(e => e.target === old)) set(node(edge.from), edge.port, target); if (manifest.start === old) { manifest.start = target; doc.set('start', target); } };
  const validPort = (n: WorkflowStage, port: Port) => { if (n.kind === 'end' || (n.kind === 'branch' ? port === 'next' : port !== 'next')) throw new Error('此节点没有指定的出端口。'); };
  let selected: string | undefined;
  if (operation.type === 'insert') {
    if (map.has(operation.id)) throw new Error('节点 ID 重复。');
    let target = operation.target, incoming: GraphEdge[] = [];
    if (operation.from) { const source = node(operation.from), port = operation.port ?? 'next'; validPort(source, port); target = source[port]; incoming = [{ from: source.id, port, target: target ?? '' }]; }
    else { if (!target) throw new Error('请选择插入位置。'); incoming = graphEdges(manifest).filter(e => e.target === target); if (incoming.length > 1 && !operation.all) throw new Error('此节点有多条进入路径，请选择具体连线或所有路径。'); }
    const successor = node(target!);
    if (manifest.start === successor.id && !incoming.length && operation.kind !== 'task') throw new Error('起始阶段必须是 Agent 任务。');
    if (operation.kind === 'end') throw new Error('结束节点请通过已有终点连接，不插入到流程中间。');
    const added = operation.copy ? { ...structuredClone(node(operation.copy)), id: operation.id, name: node(operation.copy).name + '（副本）',
      outputs: node(operation.copy).outputs?.map((_, i) => `generated/${operation.id}/result${i || ''}.md`) } : newStage(operation.id, operation.kind, successor.id);
    if (added.kind === 'branch') { added.whenTrue = successor.id; added.whenFalse = successor.id; delete added.next; }
    else added.next = successor.id;
    nodes.splice(nodes.indexOf(successor), 0, added); map.set(added.id, added);
    for (const edge of incoming) set(node(edge.from), edge.port, added.id);
    if (!incoming.length && manifest.start === successor.id) { manifest.start = added.id; doc.set('start', added.id); }
    selected = added.id;
  } else if (operation.type === 'delete') {
    const n = node(operation.id);
    const target = n.kind === 'branch' ? n[operation.keep ?? 'next'] : n.kind === 'end' ? operation.replacement : n.next;
    if (!target || target === n.id) throw new Error(n.kind === 'branch' ? '请选择删除条件后保留的路径。' : '请保留结束节点或选择替代终点。');
    node(target); rewire(n.id, target); erase(n.id); selected = target;
    // Prune only nodes made unreachable by explicit branch deletion; shared successors survive.
    if (n.kind === 'branch') {
      const seen = new Set<string>(); const walk = (id: string) => { if (seen.has(id)) return; seen.add(id); graphEdges(manifest).filter(e => e.from === id).forEach(e => walk(e.target)); }; walk(manifest.start!);
      for (const value of [...nodes]) if (!seen.has(value.id)) erase(value.id);
    }
  } else if (operation.type === 'move') {
    const n = node(operation.id), source = node(operation.from); validPort(source, operation.port);
    if (n.kind === 'end' || n.kind === 'branch' || manifest.start === n.id) throw new Error('首任务、条件和结束节点不能使用串行移动；请通过连接编辑调整。');
    if (source.id === n.id || source[operation.port] === n.id) throw new Error('请选择其他目标连线。');
    const target = source[operation.port]!; rewire(n.id, n.next!); set(n, 'next', target); set(source, operation.port, n.id); selected = n.id;
  } else if (operation.type === 'connect') {
    const n = node(operation.from); validPort(n, operation.port); node(operation.target); set(n, operation.port, operation.target); selected = n.id;
  } else {
    const n = node(operation.id); if (n.kind === operation.kind) return { text, selected: n.id, removed };
    if (n.kind === 'end' || operation.kind === 'end') throw new Error('终点转换涉及后续路径，请使用新增、删除和替代终点操作。');
    if (manifest.start === n.id && operation.kind !== 'task') throw new Error('起始阶段必须是 Agent 任务。');
    if (n.kind === 'branch' && n.whenTrue !== n.whenFalse) throw new Error('请先删除条件并选择保留路径，再转换类型。');
    const target = n.kind === 'branch' ? n.whenTrue : n.next;
    set(n, 'kind', operation.kind);
    for (const [key, value] of Object.entries(newStage(n.id, operation.kind, target))) if (!['id', 'name', 'kind'].includes(key) && (['next','whenTrue','whenFalse'].includes(key) || (n as any)[key] === undefined)) set(n, key, value);
    const obsolete = operation.kind === 'branch' ? ['next'] : ['whenTrue', 'whenFalse'];
    for (const key of obsolete) { delete (n as any)[key]; ast.get(n.id)?.delete(key); } selected = n.id;
  }
  validateGraph(manifest);
  const seq = doc.createNode([]) as any;
  for (const n of nodes) seq.items.push(ast.get(n.id) ?? doc.createNode(n));
  doc.set('stages', seq); return { text: doc.toString(), selected, removed };
}

/** Longest-path levels for an acyclic graph; merges are below every predecessor. */
export function automaticLayout(manifest: Pick<WorkflowManifest, 'stages' | 'start'>): Record<string, { x: number; y: number }> {
  const nodes = manifest.stages ?? [], edges = graphEdges(manifest), indegree = new Map(nodes.map(n => [n.id, edges.filter(e => e.target === n.id).length]));
  const level = new Map(nodes.map(n => [n.id, 0])), queue = nodes.filter(n => !indegree.get(n.id)).map(n => n.id), order: string[] = [];
  while (queue.length) { const id = queue.shift()!; order.push(id); for (const e of edges.filter(e => e.from === id)) { level.set(e.target, Math.max(level.get(e.target) ?? 0, (level.get(id) ?? 0) + 1)); indegree.set(e.target, (indegree.get(e.target) ?? 1) - 1); if (!indegree.get(e.target)) queue.push(e.target); } }
  for (const n of nodes) if (!order.includes(n.id)) order.push(n.id);
  const groups = new Map<number, string[]>(); for (const id of order) { const depth = level.get(id) ?? 0; groups.set(depth, [...(groups.get(depth) ?? []), id]); }
  const maxWidth = Math.max(1, ...[...groups.values()].map(g => g.length));
  return Object.fromEntries([...groups].flatMap(([depth, ids]) => ids.map((id, i) => [id, { x: 48 + ((maxWidth - ids.length) / 2 + i) * 328, y: 104 + depth * 180 }])));
}
