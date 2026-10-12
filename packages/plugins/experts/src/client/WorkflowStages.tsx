import * as React from 'react';
import type { WorkflowRun } from '../workflows/authoring.js';
import type { WorkflowApi } from './WorkflowEditor.js';
import { WorkflowRunGraph } from './WorkflowRunGraph.js';
export { WorkflowStages } from './StageDesigner.js';

export function WorkflowRuns({ id, api, openSession, disabled }: { id: string; api: WorkflowApi; openSession: (id: string) => Promise<void>; disabled: boolean }) {
  const [runs, setRuns] = React.useState<WorkflowRun[]>([]), [error, setError] = React.useState(''), [busy, setBusy] = React.useState('');
  const [expanded, setExpanded] = React.useState<string>();
  const liveRuns = React.useRef(runs); liveRuns.current = runs;
  const load = React.useCallback(async () => { setRuns(await api<WorkflowRun[]>({ action: 'runs', workflowId: id })); }, [id, api]);
  React.useEffect(() => { void load().catch(error => setError((error as Error).message)); const timer = window.setInterval(() => { if (!document.hidden && liveRuns.current.some(r => r.status === 'active')) void load().catch(error => setError((error as Error).message)); }, 8000); return () => window.clearInterval(timer); }, [load]);
  const act = async (run: WorkflowRun, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(run.id); setError('');
    try { await api({ action, workflowId: id, runId: run.id, expectedRunRevision: run.revision, operationId: window.crypto.randomUUID(), ...extra }); await load(); }
    catch (error) { setError((error as Error).message); await load().catch(() => undefined); }
    finally { setBusy(''); }
  };
  return <section aria-label="工作流运行"><h3>工作流运行</h3><p>自动运行会依次提交 AI 节点，验证文件后推进，人工确认时暂停。历史手动运行仍在原生会话发送任务后检查产出。</p><button disabled={!!busy} onClick={() => void load().catch(error => setError((error as Error).message))}>刷新运行状态</button>
    {error && <p role="alert">{error}</p>}{!runs.length && <p>暂无阶段运行。</p>}
    {[...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(run => <article className="wd-wfe-version" key={run.id}><span className="wd-stage-pill">{run.automation?'自动运行':'手动运行'}</span><strong>当前节点：{run.current} · {({ active: run.phase === 'running' ? '任务执行中' : run.phase === 'check' ? '待检查产出' : run.phase === 'needs-capability' ? '等待能力就绪' : '待开始', paused: '已暂停推进', 'awaiting-approval': '等待人工确认', failed: '待修复', completed: '已验收完成' })[run.status]}</strong><p className="wd-workflow-note">固定版本 {run.revisionId.slice(-8)} · {run.capabilities?.executor?.name ?? '工作流原版角色'} · {run.capabilities?.skills.length ?? 0} 项绑定技能</p>{run.capabilities && <p className="wd-workflow-note">会话已应用连接器：{run.capabilities.connectors.map(c => c.serverName).join('、') || '无'}；实际选择 {run.capabilities.connectorIds.length} 项。</p>}{run.error && <p role="alert">{run.error}</p>}
      {run.sessionId && <button disabled={disabled || !!busy} onClick={() => { setBusy(run.id); void openSession(run.sessionId!).catch(error => setError((error as Error).message)).finally(() => setBusy('')); }}>打开当前原生会话</button>}
      {(run.status === 'active' || run.status === 'failed') && <button disabled={disabled || !!busy || run.status === 'active' && ['ready','running'].includes(run.phase ?? '')} onClick={() => void act(run, 'run-continue')}>检查产出 / 修复后重试</button>}
      {run.status === 'failed' && run.receipts.some(receipt => receipt.sessionId) && <button disabled={disabled || !!busy} onClick={() => void act(run, 'run-repair')}>退回上一任务修复</button>}
      {run.status === 'awaiting-approval' && <><button disabled={disabled || !!busy} onClick={() => void act(run, 'run-approve', { approve: true })}>通过并继续</button><button disabled={disabled || !!busy} onClick={() => void act(run, 'run-approve', { approve: false })}>不通过</button></>}
      {run.status !== 'completed' && <button disabled={disabled || !!busy} onClick={() => void act(run, run.status === 'paused' ? 'run-resume' : 'run-pause')}>{run.status === 'paused' ? '恢复推进' : '暂停推进'}</button>}
      <button aria-expanded={expanded === run.id} onClick={() => setExpanded(expanded === run.id ? undefined : run.id)}>{expanded === run.id ? '收起运行图' : '查看本次运行图'}</button>
      {(expanded === run.id || !expanded&&run.automation&&run.id===[...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.id) && <WorkflowRunGraph run={run} api={api} openSession={openSession} />}
      <details><summary>真实验收记录（{run.receipts.length}）</summary>{run.receipts.map((receipt, index) => <div key={index}><p>{receipt.stageId} · {receipt.at}{receipt.reset ? ' · 已退回修复' : ''}{receipt.approvedBy ? ' · 用户确认' : ''}{receipt.decision !== undefined ? ' · ' + (receipt.decision ? '通过 / 文件存在' : '未通过 / 文件不存在') : ''}</p>{receipt.sessionId && <p>原生会话：<button onClick={() => void openSession(receipt.sessionId!).catch(error => setError((error as Error).message))}>{receipt.sessionId}</button></p>}{receipt.files && <pre>{Object.entries(receipt.files).map(([path, digest]) => path + ' · SHA256 ' + digest).join('\n')}</pre>}</div>)}</details>
    </article>)}
  </section>;
}
