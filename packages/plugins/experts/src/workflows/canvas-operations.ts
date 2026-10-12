import { presetDocument, type WorkflowManifest, type WorkflowStage } from './authoring.js';
import { graphEdges, newStage, type Port, type GraphEdge } from './graph-operations.js';

export const entryNodeId = '__entry';
export type CanvasOperation =
  | { type: 'add'; node: WorkflowStage }
  | { type: 'connect'; edge: GraphEdge; previous?: GraphEdge }
  | { type: 'disconnect'; edge: GraphEdge }
  | { type: 'remove'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; copies: Record<string, string> }
  | { type: 'start'; target?: string };

/** Free editing permits detached drafts; runtime validation still requires complete paths. */
export function validateCanvasDraft(manifest: WorkflowManifest) {
  const nodes = manifest.stages ?? [];
  if (!Array.isArray(nodes) || nodes.length > 32) throw new Error('当前工作流最多支持 32 个节点。');
  const map = new Map<string, WorkflowStage>();
  for (const n of nodes) {
    if (!n || !/^[a-z][a-z0-9-]{0,39}$/.test(n.id) || map.has(n.id) || !['task','approval','check','branch','end'].includes(n.kind)) throw new Error('节点 ID 或类型无效。');
    map.set(n.id, n);
  }
  if (manifest.start && map.get(manifest.start)?.kind !== 'task') throw new Error('开始节点需要连接到一个 AI 任务，以建立授权工作区。');
  const edges = graphEdges(manifest).filter(e => e.target);
  for (const edge of edges) if (!map.has(edge.target)) throw new Error('连线指向不存在的节点。');
  const seen = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('循环连接会重复执行任务，当前工作流不支持循环。');
    if (seen.has(id)) return;
    active.add(id);
    for (const e of edges.filter(e => e.from === id)) visit(e.target);
    active.delete(id); seen.add(id);
  };
  nodes.forEach(n => visit(n.id));
}

export function editCanvas(text: string, operation: CanvasOperation) {
  const doc = presetDocument(text);
  if (doc.errors.length) throw new Error('请先修复 YAML 语法。');
  const manifest = doc.toJS({maxAliasCount: 0}) as WorkflowManifest;
  const nodes = manifest.stages ?? [], seq = doc.getIn(['stages'], true) as any;
  const ast = new Map<string, any>(nodes.map((n,i) => [n.id, seq.items[i]]));
  const get = (id: string) => { const n = nodes.find(n => n.id === id); if (!n) throw new Error('节点不存在。'); return n; };
  const set = (n: WorkflowStage, port: Port, target?: string) => {
    if (target) { (n as any)[port] = target; ast.get(n.id)?.set(port,target); }
    else { delete (n as any)[port]; ast.get(n.id)?.delete(port); }
  };
  const setStart = (target?: string) => {
    if (target && get(target).kind !== 'task') throw new Error('开始节点只能连接到 AI 任务。');
    manifest.start = target;
    if (target) doc.set('start',target); else doc.delete('start');
  };
  const validPort = (node: WorkflowStage, port: Port) => {
    if (node.kind === 'end' || (node.kind === 'branch' ? !['whenTrue','whenFalse'].includes(port) : port !== 'next')) throw new Error('节点没有这个输出端口。');
  };
  const disconnect = (e: GraphEdge) => {
    if (e.from === entryNodeId) { if (manifest.start === e.target) setStart(); return; }
    const n = get(e.from); validPort(n,e.port);
    if (n[e.port] !== e.target) throw new Error('这条连线已改变，请重新选择。');
    set(n,e.port);
  };
  let selected: string[] = [];
  if (operation.type === 'add') {
    if (nodes.some(n => n.id === operation.node.id)) throw new Error('节点 ID 已存在。');
    const n = structuredClone(operation.node); nodes.push(n); ast.set(n.id,doc.createNode(n)); selected=[n.id];
  } else if (operation.type === 'connect') {
    const e = operation.edge; get(e.target);
    if (operation.previous) disconnect(operation.previous);
    if (e.from === entryNodeId) setStart(e.target);
    else { const n=get(e.from); validPort(n,e.port); set(n,e.port,e.target); }
    selected=[e.target];
  } else if (operation.type === 'disconnect') disconnect(operation.edge);
  else if (operation.type === 'start') setStart(operation.target);
  else if (operation.type === 'remove') {
    const ids = new Set(operation.ids); ids.forEach(get);
    for (const e of graphEdges(manifest)) if (ids.has(e.target) && !ids.has(e.from)) set(get(e.from),e.port);
    if (manifest.start && ids.has(manifest.start)) setStart();
    for (let i=nodes.length-1;i>=0;i--) if(ids.has(nodes[i].id)) nodes.splice(i,1);
  } else {
    const originals = operation.ids.map(get), copiedIds = new Set(Object.values(operation.copies));
    if (copiedIds.size !== originals.length || [...copiedIds].some(id => nodes.some(n => n.id === id))) throw new Error('副本 ID 必须独立且唯一。');
    const paths = new Map<string,string>();
    for (const n of originals) n.outputs?.forEach((p,i) => paths.set(p,'generated/'+operation.copies[n.id]+'/'+(i?i+'-':'')+p.split('/').at(-1)));
    for (const source of originals) {
      const id=operation.copies[source.id]; if(!id)throw new Error('副本映射不完整。');
      const n={...structuredClone(source),id,name:source.name+'（副本）'};
      if(n.outputs)n.outputs=n.outputs.map(p=>paths.get(p)!);
      if(n.inputs)n.inputs=n.inputs.map(p=>paths.get(p)??p);
      if(n.file)n.file=paths.get(n.file)??n.file;
      for(const port of ['next','whenTrue','whenFalse'] as const) { const target=n[port]; if(target && operation.copies[target]) n[port]=operation.copies[target]; else delete n[port]; }
      const copy=ast.get(source.id).clone();
      for(const key of ['id','name','inputs','outputs','file','next','whenTrue','whenFalse']) if((n as any)[key]===undefined)copy.delete(key);else copy.set(key,(n as any)[key]);
      nodes.push(n);ast.set(id,copy);selected.push(id);
    }
  }
  manifest.stages=nodes;validateCanvasDraft(manifest);
  const result=doc.createNode([]) as any;for(const n of nodes)result.items.push(ast.get(n.id));
  doc.set('stages',result);
  return { text:doc.toString(),selected };
}

export function horizontalLayout(manifest: Pick<WorkflowManifest,'stages'|'start'>) {
  const nodes=manifest.stages??[],edges=graphEdges(manifest).filter(e=>nodes.some(n=>n.id===e.target));
  const degree=new Map(nodes.map(n=>[n.id,edges.filter(e=>e.target===n.id).length]));
  const level=new Map(nodes.map(n=>[n.id,0])), queue=nodes.filter(n=>!degree.get(n.id)).map(n=>n.id),order:string[]=[];
  while(queue.length){const id=queue.shift()!;order.push(id);for(const e of edges.filter(e=>e.from===id)){level.set(e.target,Math.max(level.get(e.target)??0,(level.get(id)??0)+1));degree.set(e.target,(degree.get(e.target)??1)-1);if(!degree.get(e.target))queue.push(e.target);}}
  for(const n of nodes)if(!order.includes(n.id))order.push(n.id);
  const groups=new Map<number,string[]>();for(const id of order){const d=level.get(id)??0;groups.set(d,[...(groups.get(d)??[]),id]);}
  const positions:Record<string,{x:number;y:number}>={[entryNodeId]:{x:24,y:200}};
  for(const [d,ids]of groups)for(const [i,id]of ids.entries())positions[id]={x:360+d*384,y:200+(i-(ids.length-1)/2)*280};
  if(manifest.start&&positions[manifest.start])positions[entryNodeId].y=positions[manifest.start].y+22;
  return positions;
}

/** Keep the App-Gen steps as actual editable nodes in a readable, folded pipeline.
 * Branches and detached drafts keep graph layout; saved manual positions remain the UI owner's choice. */
export function defaultCanvasLayout(manifest: Pick<WorkflowManifest,'stages'|'start'>) {
  const stages=manifest.stages??[];
  if(!stages.some(n=>n.gate?.kind==='app-gen')||stages.some(n=>n.kind==='branch'))return horizontalLayout(manifest);
  const byId=new Map(stages.map(n=>[n.id,n])),order:string[]=[entryNodeId],seen=new Set<string>();
  let next=manifest.start;
  while(next){
    const n=byId.get(next);
    if(!n||seen.has(next))return horizontalLayout(manifest);
    seen.add(next);order.push(next);next=n.next;
  }
  if(seen.size!==stages.length)return horizontalLayout(manifest);
  return Object.fromEntries(order.map((id,i)=>[id,{x:32+(i%4)*336,y:32+Math.floor(i/4)*232}]));
}

export function canvasProblems(manifest: WorkflowManifest) {
  const nodes=manifest.stages??[],seen=new Set<string>();
  const walk=(id:string)=>{if(seen.has(id))return;seen.add(id);graphEdges(manifest).filter(e=>e.from===id&&e.target).forEach(e=>walk(e.target));};
  if(manifest.start)walk(manifest.start);
  return nodes.map(n=>({id:n.id,message:!seen.has(n.id)?'未连接到开始节点':n.kind==='task'&&!n.prompt?.trim()?'请填写节点任务':n.kind!=='end'&&graphEdges({stages:[n]}).some(e=>!e.target)?'输出端口尚未连接':undefined})).filter(p=>p.message);
}

export function paletteNode(id:string,kind:WorkflowStage['kind']) { return newStage(id,kind); }

/** Insert space on one path without discarding positions on other manual branches. */
export function insertionPositions(manifest: WorkflowManifest, saved: Record<string,{x:number;y:number}>, edge: GraphEdge, id: string) {
  const positions = {...horizontalLayout(manifest),...saved}, from=positions[edge.from], target=positions[edge.target];
  const next={x:from.x+384,y:edge.port==='next'?from.y:target.y}, shift=Math.max(0,next.x+384-target.x);
  const seen=new Set<string>(),edges=graphEdges(manifest);
  const move=(nodeId:string)=>{if(seen.has(nodeId))return;seen.add(nodeId);positions[nodeId]={...positions[nodeId],x:positions[nodeId].x+shift};edges.filter(e=>e.from===nodeId&&e.target).forEach(e=>move(e.target));};
  move(edge.target);positions[id]=next;return positions;
}
