import * as React from 'react';
import { readManifest, type WorkflowDetail, type WorkflowManifest, type WorkflowRun } from '../workflows/authoring.js';
import { graphEdges } from '../workflows/graph-operations.js';
import { StageCanvas, stageEditorCss } from './StageCanvas.js';
import type { WorkflowApi } from './WorkflowEditor.js';

/** Read the immutable revision, never the current draft, for execution progress. */
export function WorkflowRunGraph({ run, api, openSession, selectedStage, onSelectStage, viewTeam }: { selectedStage?:string;onSelectStage?:(id:string)=>void;viewTeam?:()=>void;run: WorkflowRun; api: WorkflowApi; openSession: (id: string) => Promise<void> }) {
  const [snapshot, setSnapshot] = React.useState<{ manifest: WorkflowManifest; layout: unknown }>();
  const [error, setError] = React.useState(''), [selected, select] = React.useState(run.current), [scale, setScale] = React.useState(.6);
  React.useEffect(() => {
    const controller = new AbortController();
    void api<WorkflowDetail>({ action: 'get', workflowId: run.workflowId, revisionId: run.revisionId }, controller.signal).then(detail => {
      if (!controller.signal.aborted) setSnapshot({ manifest: readManifest(detail.draft.files), layout: JSON.parse(detail.draft.files['layout.json']?.content ?? '{}') });
    }).catch(error => { if (!controller.signal.aborted) setError((error as Error).message); });
    return () => controller.abort();
  }, [run.workflowId, run.revisionId, api]);
  React.useEffect(()=>{if(selectedStage)select(selectedStage);},[selectedStage]);
  if (error) return <p role="alert">运行图读取失败：{error}</p>;
  if (!snapshot) return <p role="status">正在读取本次运行的固定版本…</p>;
  const { manifest, layout } = snapshot, accepted = new Set<string>(), edges = graphEdges(manifest);
  for (const receipt of run.receipts) {
    if (receipt.reset) {
      const visited = new Set<string>();
      const clear = (id: string) => { if (visited.has(id)) return; visited.add(id); accepted.delete(id); edges.filter(e => e.from === id).forEach(e => clear(e.target)); };
      clear(receipt.stageId);
    } else if (!receipt.approvedBy || receipt.decision !== false) accepted.add(receipt.stageId);
  }
  const currentLabel = run.status === 'completed' ? '已验收' : run.status === 'paused' ? '已暂停' : run.status === 'failed' ? '待修复' : run.status === 'awaiting-approval' ? '待人工确认' : run.phase === 'running' ? '执行中' : run.phase === 'check' ? '待验收' : run.phase === 'needs-capability' ? '等待能力' : '待开始';
  const states = Object.fromEntries((manifest.stages ?? []).map(n => [n.id, n.id === run.current ? currentLabel : accepted.has(n.id) ? '已验收' : '待执行']));
  const node = manifest.stages?.find(n => n.id === selected), receipts = run.receipts.filter(r => r.stageId === selected);
  const sessionId = selected === run.current ? run.sessionId : [...receipts].reverse().find(r => r.sessionId)?.sessionId;
  return <div><style>{stageEditorCss}</style><p className="wd-stage-note">本图来自本次运行的固定版本；修改草稿不会改变本图。状态来自原生任务事件与真实验收记录。</p>
    <StageCanvas manifest={manifest} layout={layout} readonly selected={selected} select={id=>{select(id);onSelectStage?.(id);}} scale={scale} setScale={setScale} states={states} insert={() => undefined} moved={() => undefined} place={() => undefined} />
    {node && <section aria-label="运行阶段详情" className="wd-stage-capabilities"><strong>{node.name} · {states[node.id]}</strong>
      {sessionId && <p><button onClick={() => void openSession(sessionId).catch(error => setError((error as Error).message))}>打开此阶段会话</button></p>}
      {viewTeam&&<button onClick={viewTeam}>查看本阶段团队</button>}
<p className="wd-stage-note">{node.gate ? 'App-Gen 门禁：Step ' + node.gate.step + ' · ' + node.gate.context : ''}</p>
      {node.outputs?.length ? <p>声明产出：{node.outputs.join('、')}</p> : null}
      {receipts.length ? receipts.map((receipt, i) => <div key={i}><p>{receipt.at} · {receipt.reset ? '退回修复' : receipt.approvedBy ? receipt.decision === false ? '未通过' : '用户已确认' : '已检查'}</p>{receipt.gate && <p>App-Gen Step {receipt.gate.step}：目标、状态机及证据已验证</p>}{receipt.files && <details><summary>已验收文件与哈希</summary><pre>{Object.entries(receipt.files).map(([path, digest]) => path + ' · ' + digest).join('\n')}</pre></details>}</div>) : <p className="wd-stage-note">此阶段尚无验收记录。</p>}
    </section>}
  </div>;
}
