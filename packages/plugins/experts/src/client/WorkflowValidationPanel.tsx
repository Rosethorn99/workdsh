import * as React from 'react';
import type { CapabilityCatalog, WorkflowManifest, WorkflowValidation, WorkflowIssue } from '../workflows/authoring.js';
import type { WorkflowApi } from './WorkflowEditor.js';

export function WorkflowValidationPanel({ validation, manifest, api, workflowId, readonly, bindings, onBindingsChange, focus, map }: {
  validation: WorkflowValidation; manifest?: WorkflowManifest; api: WorkflowApi; workflowId: string; readonly: boolean;
  bindings: Record<string, string>; onBindingsChange: (bindings: Record<string, string>) => void;
  focus: (issue: WorkflowIssue) => void; map: (bindings: Record<string, string>) => void;
}) {
  const [catalog, setCatalog] = React.useState<CapabilityCatalog['connectors']>([]);
  const [error, setError] = React.useState(''), [loading, setLoading] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const missing = [...new Set(validation.issues.flatMap(i => i.connectorName ? [i.connectorName] : []))];
  React.useEffect(() => {
    if (!missing.length) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void api<CapabilityCatalog['connectors']>({ action: 'connector-catalog', workflowId }, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setCatalog(value); onBindingsChange(Object.fromEntries(Object.entries(bindings).filter(([, name]) => value.some(c => c.serverName === name))));
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '连接器列表读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, workflowId, refresh, missing.join('|')]);
  const stageLabel = (issue: WorkflowIssue) => manifest?.stages?.find(s => s.id === issue.stageId)?.name ?? issue.stageId ?? issue.path ?? '文件包';
  return <><h3>{validation.ok ? '配置校验通过' : '配置校验未通过'}</h3>
    <p>{validation.plugins} 个插件节点 · {validation.skills.length} 个 Skill</p>
    {!validation.ok && <p>请处理下列问题后重新校验，通过后可发布或运行。</p>}
    {!!missing.length && <section aria-label="工作流连接器映射"><h4>必需连接器待映射 · {missing.length} 项</h4>
      <p>在“专家 · 技能 · 连接器”中添加对应 MCP，然后刷新列表，选择本机实际提供该能力的连接器。</p>
      <button disabled={loading || readonly} onClick={() => setRefresh(value => value + 1)}>{loading ? '读取连接器…' : '刷新连接器列表'}</button>
      {error && <p role="alert">{error}</p>}
      {missing.map(name => <div key={name} className="wd-wfe-version"><strong>{name}</strong>
        <p>影响阶段：{validation.issues.filter(i => i.connectorName === name).map((issue, index) => <button key={index} onClick={() => focus(issue)}>{stageLabel(issue)}</button>)}</p>
        <label>映射到本机连接器<select aria-label={'映射连接器 ' + name} disabled={loading || readonly} value={bindings[name] ?? ''} onChange={event => onBindingsChange({ ...bindings, [name]: event.target.value })}>
          <option value="">请选择对应连接器</option>{catalog.map(c => <option key={c.serverName} value={c.serverName}>{c.title} · {c.serverName} · {c.state === 'ready' ? '已连接' : c.state} · {c.toolNames.length} 个工具</option>)}
        </select></label>
      </div>)}
      {!loading && !error && !catalog.length && <p>尚未安装本机连接器，请先添加对应 MCP。</p>}
      <button disabled={readonly || loading || !Object.values(bindings).some(Boolean)} onClick={() => map(Object.fromEntries(Object.entries(bindings).filter(([, name]) => !!name)))}>保存映射并校验</button>
      {Object.values(bindings).some(Boolean) && <p role="status">已选择连接器，映射尚未保存。点击上方“校验”或“保存映射并校验”，会先保存到所有相关节点和团队，再校验。</p>}
      <p>映射更新所有阶段和团队成员的同一份绑定，保留必需约束。运行时才会应用到会话。</p>
    </section>}
    {validation.issues.filter(i => !i.connectorName).map((issue, index) => <p key={index} role="alert"><button onClick={() => focus(issue)}>{stageLabel(issue) || '文件包'}</button> {issue.message}</p>)}
    <p>配置校验不执行模型、脚本或外部业务操作。真实交付需要在试运行会话中检查产出。</p>
  </>;
}
