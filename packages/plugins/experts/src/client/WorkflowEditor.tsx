import * as React from 'react';
import { patchYaml, pluginRows, readManifest, presetDocument, packagePath, type WorkflowDetail, type WorkflowFile, type WorkflowValidation, type WorkflowManifest, type WorkflowIssue } from '../workflows/authoring.js';
import { WorkflowStages, WorkflowRuns } from './WorkflowStages.js';
import { userWorkflowSource } from '../workflows/starters.js';
import { remapWorkflowConnector } from '../workflows/connector-mapping.js';
import { WorkflowValidationPanel } from './WorkflowValidationPanel.js';

export type WorkflowApi = <T>(payload: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
interface Props {
  initial: WorkflowDetail; api: WorkflowApi;
  start: (id: string, revisionId?: string, input?: string) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  close: () => void; copied: (detail: WorkflowDetail) => void;
}
const presetPath = 'preset/agent.cordis.yml';
const css = `
.wd-wfe{display:flex;flex-direction:column;gap:10px;min-height:0}.wd-wfe>p{margin:3px 0;font-size:12px}.wd-wfe-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.wd-wfe-bar strong{margin-right:auto}.wd-wfe-tabs{display:flex;gap:8px}.wd-wfe-tabs [aria-selected=true]{color:#737fe2;background:var(--dsw-alias-bg-layer-2);border-color:#8c98df}.wd-wfe-run{background:#737fe2!important;color:#fff!important;border-color:#737fe2!important}.wd-wfe-tabs button{font-size:12px}
.wd-wfe-layout{display:grid;grid-template-columns:230px minmax(0,1fr);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;min-height:540px;overflow:hidden}.wd-wfe-tree{overflow:auto;max-height:720px;border-right:1px solid var(--dsw-alias-border-l2);padding:10px}.wd-wfe-tree button{display:block;width:100%;text-align:left;overflow-wrap:anywhere;border:0;border-radius:4px;font-size:12px;margin-bottom:3px}.wd-wfe-tree button[aria-current=true]{background:var(--dsw-alias-interactive-bg-hover)}
.wd-wfe-main{min-width:0;padding:18px;overflow:auto}.wd-wfe-main input,.wd-wfe-main textarea,.wd-wfe-main select{box-sizing:border-box;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;width:100%}.wd-wfe-main label{display:block;margin:10px 0}.wd-wfe-code{display:flex;min-height:450px;border:1px solid var(--dsw-alias-border-l2)}.wd-wfe-lines{margin:0;padding:10px 6px;text-align:right;opacity:.5;line-height:20px;font-size:12px;min-width:30px;max-height:500px;overflow:hidden}.wd-wfe-code textarea{border:0;border-radius:0;resize:vertical;min-height:450px;line-height:20px;font:12px/20px monospace;white-space:pre;tab-size:2;overflow:auto}.wd-wfe-graph{display:grid;grid-template-columns:minmax(140px,1fr) minmax(240px,2fr);gap:16px}.wd-wfe-nodes{max-height:600px;overflow:auto}.wd-wfe-node{margin:0 0 8px;display:block;width:100%;text-align:left;overflow-wrap:anywhere}.wd-wfe-node[aria-pressed=true]{outline:2px solid #6683ef}.wd-wfe-node small{display:block;opacity:.65;margin-top:6px}.wd-wfe-main pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.wd-wfe-diff{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.wd-wfe-diff textarea{height:250px;font-family:monospace;font-size:12px}.wd-wfe-main img{max-width:100%;max-height:460px}.wd-wfe-version{border-bottom:1px solid var(--dsw-alias-border-l2);padding:12px 0}.wd-wfe-version button{margin:6px}.wd-wfe-main [role=status]{padding:8px;background:var(--dsw-alias-bg-layer-2)}
@media(max-width:950px){.wd-wfe-layout{grid-template-columns:160px minmax(0,1fr)}.wd-wfe-graph{grid-template-columns:1fr}.wd-wfe-diff{grid-template-columns:1fr}}@media(max-width:600px){.wd-wfe-layout{display:block}.wd-wfe-tree{max-height:160px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}}
`;
const errorText = (error: unknown) => error instanceof Error ? error.message : '工作流操作失败。';
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkflowEditor({ initial, api, start, openSession, close, copied }: Props) {
  const [detail, setDetail] = React.useState(initial), [patches, setPatches] = React.useState<Record<string, WorkflowFile | null>>({});
  const [tab, setTab] = React.useState<'visual' | 'stages' | 'files' | 'validation' | 'versions' | 'runs'>('stages');
  const [path, selectPath] = React.useState('workflow.yaml'), [nodeKey, selectNode] = React.useState('0');
  const [busy, setBusy] = React.useState(''), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [stageFocus,setStageFocus] = React.useState<{id:string;field?:string;token:number}>();
  const [validation, setValidation] = React.useState<WorkflowValidation>();
  const [validationRevision, setValidationRevision] = React.useState('');
  const [connectorMappings, setConnectorMappings] = React.useState<Record<string, string>>({});
  const [conflict, setConflict] = React.useState<WorkflowDetail>();
  const [newPath, setNewPath] = React.useState(''), [renamePath, setRenamePath] = React.useState('');
  const [configText, setConfigText] = React.useState('');
  const [configPending, setConfigPending] = React.useState(false);
  const [diff, setDiff] = React.useState<{ revisionId: string; changes: { path: string; kind: string }[]; path?: string; before?: WorkflowFile; after?: WorkflowFile }>();
  const editorElement = React.useRef<HTMLDivElement>(null);
  const [showDelete, setShowDelete] = React.useState(false);
  const [runDialog,setRunDialog]=React.useState(false),[runInput,setRunInput]=React.useState('');
  const [autoSave, setAutoSave] = React.useState(true), [saving, setSaving] = React.useState(false), [savePaused, setSavePaused] = React.useState(false);
  const saveFlight = React.useRef<Promise<WorkflowDetail> | undefined>(undefined);
  const live = React.useRef({ detail, patches, configPending, connectorMappings }); live.current = { detail, patches, configPending, connectorMappings };
  const files = React.useMemo(() => {
    const result = { ...detail.draft.files };
    for (const [key, value] of Object.entries(patches)) { if (value === null) delete result[key]; else result[key] = value; }
    return result;
  }, [detail, patches]);
  const fileDirty = Object.keys(patches).length > 0 || configPending;
  const mappingsPending = Object.keys(connectorMappings).length > 0;
  const dirty = fileDirty || mappingsPending;
  const currentValidation = !fileDirty && validationRevision === detail.draft.revision ? validation : undefined;
  const publicationBlocked = currentValidation?.ok === false;
  const file = files[path];
  let nodes: ReturnType<typeof pluginRows> = [], parseError = '', name = detail.draft.source.name;
  let overrides: Record<string, string> = {}, manifest: WorkflowManifest | undefined;
  try { nodes = pluginRows(files[presetPath]?.content ?? ''); } catch (error) { parseError = errorText(error); }
  try { manifest = readManifest(files); name = manifest.name; overrides = manifest.runtimeOverrides ?? {}; } catch { try { const raw=presetDocument(files['workflow.yaml']?.content??'').toJS({maxAliasCount:0});if(typeof raw?.name==='string')name=raw.name; } catch { /* Source editor remains available. */ } }
  const node = nodes.find(value => JSON.stringify(value.path) === nodeKey) ?? nodes[0];
  let specialConfig = false;
  if (node) { try { specialConfig = String(presetDocument(files[presetPath].content).getIn([...node.path, 'config'], true) ?? '').includes('!!js'); } catch { specialConfig = true; } }
  React.useEffect(() => { setConfigText(JSON.stringify(node?.row.config ?? {}, null, 2)); setConfigPending(false); }, [nodeKey, files[presetPath]?.content]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const outside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!editorElement.current?.contains(target) && target.closest?.('button,a,[role=button],[role=row]')) {
        event.preventDefault(); event.stopPropagation(); setError('请先保存草稿或放弃未保存修改，再离开编辑器。');
      }
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', outside, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', outside, true); };
  }, [dirty]);
  const change = (key: string, value: WorkflowFile | null) => { if (detail.readonly) return; setPatches(current => ({ ...current, [key]: value })); setValidation(undefined); setNotice(''); };
  const editText = (key: string, text: string) => change(key, { encoding: 'utf8', content: text });
  const visual = (key: string, field: (string | number)[], value: unknown) => {
    try { editText(key, patchYaml(files[key]?.content ?? '', field, value)); setError(''); } catch (error) { setError(errorText(error)); }
  };
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await work(); } catch (error) {
      setError(errorText(error));
      if ((error as any)?.code === 'workflows/conflict') {
        try { setConflict(await api<WorkflowDetail>({ action: 'get', workflowId: detail.draft.id })); } catch { /* Retry remains explicit. */ }
      }
      const diagnostic = (error as any)?.details;
      if (diagnostic?.validation && diagnostic.draftRevision === live.current.detail.draft.revision && !Object.keys(live.current.patches).length && !live.current.configPending && !Object.keys(live.current.connectorMappings).length) {
        setValidation(diagnostic.validation); setValidationRevision(diagnostic.draftRevision); setTab('validation');
      }
    } finally { setBusy(''); }
  };
  const mutate = <T,>(action: string, extra: Record<string, unknown> = {}) => api<T>({ action, workflowId: detail.draft.id,
    expectedRevision: detail.draft.revision, operationId: window.crypto.randomUUID(), ...extra });
  const save = async (): Promise<WorkflowDetail> => {
    if (saveFlight.current) await saveFlight.current;
    const current = live.current;
    if (current.configPending) throw new Error('请先应用或撤销尚未应用的插件参数。');
    let sent = current.patches;
    if (Object.keys(current.connectorMappings).length) {
      const source = sent['workflow.yaml'] === undefined ? current.detail.draft.files['workflow.yaml'] : sent['workflow.yaml'];
      if (!source || source.encoding !== 'utf8') throw new Error('连接器映射需要有效的 workflow.yaml。');
      let text = source.content;
      for (const [from, to] of Object.entries(current.connectorMappings)) text = remapWorkflowConnector(text, from, to);
      sent = { ...sent, 'workflow.yaml': { encoding: 'utf8', content: text } };
      live.current.patches = sent; setPatches(sent);
      live.current.connectorMappings = {}; setConnectorMappings({}); setValidation(undefined);
    }
    if (!Object.keys(sent).length) return current.detail;
    setSaving(true);
    const pending = api<WorkflowDetail>({ action: 'save', workflowId: current.detail.draft.id, expectedRevision: current.detail.draft.revision, operationId: window.crypto.randomUUID(), patches: sent }).then(value => {
      setDetail(value); live.current.detail = value;
      const remaining = { ...live.current.patches }; for (const key of Object.keys(sent)) if (JSON.stringify(remaining[key]) === JSON.stringify(sent[key])) delete remaining[key];
      live.current.patches = remaining; setPatches(remaining); setConflict(undefined); setSavePaused(false); setNotice('草稿已保存，尚未发布。'); return value;
    });
    saveFlight.current = pending;
    try { return await pending; } finally { saveFlight.current = undefined; setSaving(false); }
  };
  React.useEffect(() => {
    if (!autoSave || savePaused || busy || conflict || detail.readonly || configPending || !Object.keys(patches).length) return;
    const timer = window.setTimeout(() => { void save().catch(async cause => { setSavePaused(true); setError(errorText(cause)); if ((cause as any)?.code === 'workflows/conflict') { try { setConflict(await api<WorkflowDetail>({ action: 'get', workflowId: live.current.detail.draft.id })); } catch { /* Local patches remain intact. */ } } }); }, 1500);
    return () => window.clearTimeout(timer);
  }, [patches, autoSave, savePaused, busy, conflict, detail.readonly, configPending]);
  const verify = async (saved: WorkflowDetail): Promise<WorkflowValidation> => {
    const result = await api<WorkflowValidation>({ action: 'validate', workflowId: saved.draft.id, expectedRevision: saved.draft.revision });
    const current = live.current;
    if (current.detail.draft.id !== saved.draft.id || current.detail.draft.revision !== saved.draft.revision || Object.keys(current.patches).length || current.configPending || Object.keys(current.connectorMappings).length) throw new Error('校验期间草稿已修改，请保存并重新校验。');
    setValidation(result); setValidationRevision(saved.draft.revision);
    if (!result.ok) { setTab('validation'); setRunDialog(false); setNotice('草稿未通过校验，请先处理下列问题。'); }
    return result;
  };
  const publish = async (kind: 'publish' | 'trial') => {
    const saved = await save();
    if (!(currentValidation?.ok && validationRevision === saved.draft.revision) && !(await verify(saved)).ok) return;
    const value = await api<WorkflowDetail>({ action: kind, workflowId: saved.draft.id, expectedRevision: saved.draft.revision, operationId: window.crypto.randomUUID() });
    setDetail(value); setPatches({});
    if (kind === 'publish') { setNotice('已发布。新会话使用此版本，原有会话保持原版本。'); setTab('versions'); }
    else {
      const revision = value.revisions.filter(row => row.kind === 'trial' && row.draftRevision === saved.draft.revision).at(-1)
        ?? value.revisions.filter(row => row.kind === 'trial').at(-1);
      if (!revision) throw new Error('试运行快照未创建。');
      const staged=readManifest(saved.draft.files).mode==='staged';
      await start(value.draft.id, revision.id, staged?runInput.trim():undefined);
      if(staged){setRunDialog(false);setTab('runs');setNotice('已启动：AI 节点自动推进，人工确认节点暂停。');}
    }
  };
  const reorder = (delta: number) => {
    if (!node) return;
    try {
      const doc = presetDocument(files[presetPath].content), parent = doc.getIn(node.path.slice(0, -1), true) as any;
      const i = Number(node.path.at(-1)), j = i + delta;
      if (!parent?.items || j < 0 || j >= parent.items.length) return;
      [parent.items[i], parent.items[j]] = [parent.items[j], parent.items[i]];
      editText(presetPath, doc.toString()); selectNode(JSON.stringify([...node.path.slice(0, -1), j]));
    } catch (error) { setError(errorText(error)); }
  };
  return <div ref={editorElement} className="wd-wfe" aria-label="工作流编辑器">
    <style>{css}</style>
    <div className="wd-wfe-bar"><button onClick={close} disabled={dirty || !!busy || saving}>返回列表</button><strong>{name}</strong><span>{detail.readonly ? '只读来源 / 版本' : saving ? '保存中…' : savePaused ? '保存已暂停，请处理错误' : mappingsPending ? '连接器映射待保存' : dirty ? '有未保存修改' : '草稿已保存'}</span>
      {detail.readonly ? <button disabled={!!busy} onClick={() => void run('复制', async () => copied(await mutate<WorkflowDetail>('copy', { ...(detail.draft.revision.startsWith('rev-') ? { revisionId: detail.draft.revision } : {}) })))}>复制并编辑</button> : <>
        <label style={{ display: 'flex', gap: 5, margin: 0 }}><input type="checkbox" checked={autoSave} onChange={event => { setAutoSave(event.target.checked); setSavePaused(false); }} />自动保存</label><button disabled={!!busy || !dirty || saving} onClick={() => void run('保存', async () => { await save(); })}>保存草稿</button>
        <button disabled={!!busy} onClick={() => void run('校验', async () => { await verify(await save()); setTab('validation'); })}>校验</button>
        <button className="wd-wfe-run" disabled={!!busy || publicationBlocked || configPending} onClick={() => void run('校验运行条件', async () => { const saved = await save(); if (!(await verify(saved)).ok) return; if(readManifest(saved.draft.files).mode==='staged')setRunDialog(true);else await publish('trial'); })}>▶ 运行</button>
        <button disabled={!!busy || publicationBlocked || configPending} onClick={() => void run('发布', () => publish('publish'))}>发布版本</button>
      </>}
      {!detail.draft.id.startsWith('workdsh-') && <details><summary>更多</summary><button disabled={!!busy || !detail.draft.publishedRevision || dirty} onClick={() => void run('创建会话', () => start(detail.draft.id))}>用于新会话</button><button disabled={!!busy || dirty} onClick={() => void run('导出', async () => download(await api({ action: 'export', workflowId: detail.draft.id, ...(detail.readonly ? { revisionId: detail.draft.revision } : {}) }), name + '.workdsh-workflow.json'))}>导出文件包</button></details>}
    </div>
    <p className="wd-workflow-note">{detail.draft.source.sourceId === userWorkflowSource.sourceId ? '用户创建' : '来源 ' + detail.draft.upstream.commit.slice(0, 12)} · {detail.draft.upstream.license} · {Object.keys(files).length} 个文件。运行固定当前草稿版本；AI 节点自动执行，人工确认时暂停。保存不会启动任务。</p>
    {dirty && <div className="wd-wfe-bar"><span>切换可视化与文件视图会保留修改。</span><button disabled={!!busy} onClick={() => { setPatches({}); setConnectorMappings({}); setConfigPending(false); setConfigText(JSON.stringify(node?.row.config ?? {}, null, 2)); setConflict(undefined); setValidation(undefined); setError(''); }}>放弃未保存修改</button></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">正在{busy}…</p>}
    {publicationBlocked && <p role="status">发布和运行已暂停：请修复验证页中的问题，再点击“校验”。</p>}
    {runDialog&&<section role="dialog" aria-label="运行工作流" className="wd-stage-menu"><strong>运行工作流</strong><p>输入本次需求。AI 节点自动执行并检查产出，人工确认节点等待你审核。</p><textarea aria-label="本次运行需求" rows={4} maxLength={32000} placeholder="描述你希望此工作流完成的任务…" value={runInput} onChange={e=>setRunInput(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:12,border:'1px solid var(--dsw-alias-border-l2)',borderRadius:8,background:'var(--dsw-alias-bg-base)',color:'inherit'}}/><button disabled={!!busy||!runInput.trim()} onClick={()=>void run('启动运行',()=>publish('trial'))}>▶ 启动运行</button><button disabled={!!busy} onClick={()=>setRunDialog(false)}>取消</button></section>}
    <nav className="wd-wfe-tabs" aria-label="工作流编辑视图">{([['stages', 'AI 编排'], ['visual', '角色与能力'], ['files', '文件'], ['validation', '验证'], ['versions', '版本'], ['runs', '运行']] as const).map(([key, label]) => <button key={key} disabled={configPending || (key === 'runs' && detail.draft.id.startsWith('workdsh-'))} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="wd-wfe-layout" style={tab === 'files' ? undefined : { gridTemplateColumns: 'minmax(0,1fr)' }}>{tab === 'files' && <aside className="wd-wfe-tree" aria-label="工作流文件树">
      {Object.keys(files).sort().map(key => <button key={key} disabled={configPending} aria-current={path === key} title={key} onClick={() => { selectPath(key); setTab('files'); setShowDelete(false); }}>{patches[key] ? '● ' : ''}{key}</button>)}
    </aside>}<main className="wd-wfe-main" style={tab==='stages'?{padding:0}:undefined}>
      <div hidden={tab !== 'stages'}><WorkflowStages files={files} focus={stageFocus} workflowId={detail.draft.id} api={api} change={updates => { setPatches(current => ({ ...current, ...Object.fromEntries(Object.entries(updates).map(([key, text]) => [key, { encoding: 'utf8' as const, content: text }])) })); setValidation(undefined); setNotice(''); }} readonly={detail.readonly || !!busy} /></div>
      {tab === 'runs' && <WorkflowRuns id={detail.draft.id} api={api} openSession={openSession} disabled={dirty || !!busy} />}
      {conflict && <section aria-label="草稿冲突比较"><h3>草稿冲突：保留了你的修改</h3><p>选择每个冲突文件，比较原始内容、本地修改和服务器最新版，在文件视图完成合并。</p>
        <p>{Object.keys(patches).filter(key => JSON.stringify(detail.draft.files[key]) !== JSON.stringify(conflict.draft.files[key])).join('、') || '其他文件已更新'}</p>
        <div className="wd-wfe-diff">{[['原始', detail.draft.files[path]], ['本地', files[path]], ['服务器最新', conflict.draft.files[path]]].map(([label, value]) => <label key={String(label)}>{String(label)}<textarea readOnly value={(value as WorkflowFile)?.content ?? '文件不存在'} /></label>)}</div>
        <button onClick={() => { setDetail(conflict); setConflict(undefined); setNotice('已切换到最新基底；本地修改仍保留，请完成合并后保存。'); }}>采用最新基底，继续手动合并</button>
      </section>}
      {tab === 'visual' && <>
        <label>工作流名称<input aria-label="工作流名称" value={(() => { try { return readManifest(files).name; } catch { return ''; } })()} disabled={detail.readonly || !!busy || configPending} onChange={event => visual('workflow.yaml', ['name'], event.target.value)} /></label>
        <label>说明<textarea aria-label="工作流说明" rows={3} value={(() => { try { return readManifest(files).description; } catch { return ''; } })()} disabled={detail.readonly || !!busy || configPending} onChange={event => visual('workflow.yaml', ['description'], event.target.value)} /></label>
        <p className="wd-workflow-note">下方是实际 Preset 插件结构；排列表示装载顺序，阶段说明不会被当作调度进度。</p>
        {parseError ? <p role="alert">配置不能同步：{parseError}。请在文件视图修复。</p> : <div className="wd-wfe-graph">
          <div className="wd-wfe-nodes">{nodes.map(value => <button className="wd-wfe-node" disabled={configPending} key={JSON.stringify(value.path)} aria-pressed={node === value} style={{ marginLeft: value.depth * 8, width: `calc(100% - ${value.depth * 8}px)` }} onClick={() => selectNode(JSON.stringify(value.path))}>{value.row.group ? '▣ ' : '○ '}{String(value.row.id ?? '未命名节点')}<small>{String(value.row.name ?? '')}</small></button>)}</div>
          {node && <section aria-label="插件属性"><strong>{String(node.row.id)}</strong><p className="wd-workflow-note">{String(node.row.name ?? '')}</p>
            {String(node.row.name).startsWith('./runtime/') && <>
              <label>实际运行模块<select aria-label="实际运行模块" value={overrides[String(node.row.name)] ?? ''} disabled={detail.readonly || !!busy || configPending} onChange={event => {
                const next = { ...overrides }; if (event.target.value) next[String(node.row.name)] = event.target.value; else delete next[String(node.row.name)]; visual('workflow.yaml', ['runtimeOverrides'], next);
              }}><option value="">使用平台默认适配</option>{Object.keys(files).filter(key => /^preset\/(runtime|workdsh-runtime)\/.+\.[cm]?js$/.test(key)).map(key => <option key={key} value={key}>{key}</option>)}</select></label>
              {overrides[String(node.row.name)] && <button disabled={configPending} onClick={() => { selectPath(overrides[String(node.row.name)]); setTab('files'); }}>编辑实际运行脚本</button>}
            </>}
            <label>节点 ID<input value={node.row.id ?? ''} disabled={detail.readonly || !!busy || configPending} onChange={event => visual(presetPath, [...node.path, 'id'], event.target.value)} /></label>
            {typeof node.row.disabled === 'string' ? <p>平台条件：{node.row.disabled}（在文件视图编辑）</p> : <label><input type="checkbox" style={{ width: 'auto' }} checked={node.row.disabled !== true} disabled={detail.readonly || !!busy || configPending} onChange={event => visual(presetPath, [...node.path, 'disabled'], !event.target.checked)} /> 启用此节点</label>}
            <button disabled={detail.readonly || !!busy || configPending} onClick={() => reorder(-1)}>上移</button>{' '}<button disabled={detail.readonly || !!busy || configPending} onClick={() => reorder(1)}>下移</button>
            {node.row.name === '@deepseek-ai/dsh-persona' && <label>完整角色提示<textarea aria-label="完整角色提示" rows={12} value={node.row.config?.text ?? ''} disabled={detail.readonly || !!busy || configPending} onChange={event => visual(presetPath, [...node.path, 'config', 'text'], event.target.value)} /></label>}
            {node.row.name === '@deepseek-ai/dsh-skill-filesystem' && <><label><input type="checkbox" style={{ width: 'auto' }} disabled={detail.readonly || !!busy || configPending} checked={node.row.config?.includeDefaultRoots !== false} onChange={event => visual(presetPath, [...node.path, 'config', 'includeDefaultRoots'], event.target.checked)} /> 同时发现默认工作区 / 用户 Skills</label><p>包内 Skills（点击编辑完整文件）：</p>{Object.keys(files).filter(key => key.endsWith('/SKILL.md')).map(key => <button key={key} onClick={() => { selectPath(key); setTab('files'); }}>{key.split('/').at(-2)}</button>)}<p className="wd-workflow-note">新增包内 Skill 会由此目录加载；改动附带技能只影响此工作流的新版本。</p></>}
            {!node.row.group && node.row.name !== '@deepseek-ai/dsh-persona' && node.row.name !== '@deepseek-ai/dsh-skill-filesystem' && <>
              <label>参数（JSON）<textarea rows={10} value={configText} disabled={detail.readonly || !!busy || specialConfig} onChange={event => { setConfigText(event.target.value); setConfigPending(true); }} /></label>
              <button disabled={detail.readonly || !!busy || specialConfig} onClick={() => { try { const value = JSON.parse(configText); visual(presetPath, [...node.path, 'config'], value); setConfigPending(false); } catch (error) { setError(errorText(error)); } }}>应用参数</button>{' '}
              {configPending && <button onClick={() => { setConfigText(JSON.stringify(node.row.config ?? {}, null, 2)); setConfigPending(false); }}>撤销参数修改</button>}
              <p className="wd-workflow-note">未映射字段保持原样；!!js 平台条件及特殊配置请在文件视图编辑。</p>
            </>}
          </section>}
        </div>}
      </>}
      {tab === 'files' && <>
        <div className="wd-wfe-bar"><strong>{path}</strong>{file && !detail.readonly && <button disabled={!!busy} onClick={() => setShowDelete(!showDelete)}>删除文件</button>}</div>
        {overrides['./' + path.replace(/^preset\//, '')] && <p role="status">这是留存的原始模块；当前实际运行使用 <button onClick={() => selectPath(overrides['./' + path.replace(/^preset\//, '')])}>{overrides['./' + path.replace(/^preset\//, '')]}</button>。可在可视化模块属性切换运行入口。</p>}
        {showDelete && <p>删除后需校验引用。<button onClick={() => { change(path, null); setShowDelete(false); }}>确认删除此文件</button></p>}
        {file?.encoding === 'utf8' ? <div className="wd-wfe-code"><pre className="wd-wfe-lines" aria-hidden="true">{file.content.split('\n').map((_, index) => index + 1).join('\n')}</pre><textarea aria-label="文件内容" spellCheck={false} wrap="off" readOnly={detail.readonly || !!busy} value={file.content} onChange={event => editText(path, event.target.value)} onScroll={event => { const lines = event.currentTarget.previousElementSibling; if (lines) lines.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => { if (event.key === 'Tab' && !detail.readonly) { event.preventDefault(); const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd; editText(path, file.content.slice(0, start) + '  ' + file.content.slice(end)); requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = start + 2; }); } }} /></div>
          : file ? <><p>二进制资源 · Base64 保存</p>{/\.(png|jpe?g|gif|webp)$/i.test(path) && <img alt={path} src={`data:image/${/\.jpe?g$/i.test(path) ? 'jpeg' : path.split('.').at(-1)};base64,${file.content}`} />}</> : <p>文件不存在或已在草稿中删除。</p>}
        {!detail.readonly && <>
          <label>重命名为<input value={renamePath} placeholder="包内相对路径" onChange={event => setRenamePath(event.target.value)} /></label>
          <button disabled={!!busy || !file || !renamePath} onClick={() => { try { const next = packagePath(renamePath); if (files[next]) throw new Error('目标文件已存在。'); change(next, file); change(path, null); selectPath(next); setRenamePath(''); setNotice('已重命名；请更新引用后保存并校验。'); } catch (error) { setError(errorText(error)); } }}>重命名</button>
          <label>新增文件路径<input value={newPath} placeholder="例如 preset/skills/my-skill/SKILL.md" onChange={event => setNewPath(event.target.value)} /></label>
          <button disabled={!!busy || !newPath} onClick={() => { try { const key = packagePath(newPath); if (files[key]) throw new Error('文件已存在。'); editText(key, key.endsWith('/SKILL.md') ? `---\nname: ${key.split('/').at(-2)}\ndescription: 请填写技能说明\n---\n\n请填写完整技能规范。\n` : ''); selectPath(key); setNewPath(''); } catch (error) { setError(errorText(error)); } }}>新增文本文件</button>
          <label>上传或替换文件（路径使用上方新增路径，否则替换当前文件）<input type="file" disabled={!!busy} onChange={event => { const upload = event.target.files?.[0]; if (!upload) return; void run('上传', async () => { const key = packagePath(newPath || path); if (upload.size > 4 * 1024 * 1024) throw new Error('单文件上限 4 MiB。'); const bytes = new Uint8Array(await upload.arrayBuffer());
            if (/\.(md|ya?ml|json|html|css|[cm]?js|ts|txt|py|sh|ps1)$/i.test(key)) { editText(key, new TextDecoder('utf8', { fatal: true }).decode(bytes)); }
            else { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); change(key, { encoding: 'base64', content: btoa(binary) }); }
            selectPath(key); setNewPath(''); }); event.target.value = ''; }} /></label>
        </>}
      </>}
      {tab === 'validation' && (currentValidation ? <WorkflowValidationPanel validation={currentValidation} manifest={manifest} api={api} workflowId={detail.draft.id} readonly={detail.readonly || !!busy} bindings={connectorMappings} onBindingsChange={bindings => setConnectorMappings(Object.fromEntries(Object.entries(bindings).filter(([, name]) => !!name)))} focus={(issue: WorkflowIssue) => { if(issue.stageId){setStageFocus({id:issue.stageId,field:issue.field,token:Date.now()});setTab('stages');}else{selectPath(issue.path);setTab('files');} }} map={() => void run('保存映射并校验', async () => { await verify(await save()); setTab('validation'); })} /> : <p>保存并点击“校验”检查当前草稿。修改后需要重新校验。</p>)}
      {tab === 'versions' && <>
        <p>默认发布版本：{detail.draft.publishedRevision ?? '尚未发布'}。旧会话不会因发布或回滚而改变。</p>
        {detail.readonly && !detail.draft.id.startsWith('workdsh-') && <button onClick={() => void run('打开草稿', async () => { setDetail(await api<WorkflowDetail>({ action: 'get', workflowId: detail.draft.id })); setPatches({}); setTab('visual'); })}>返回可编辑草稿</button>}
        {detail.revisions.length === 0 && <p>没有发布或试运行版本。</p>}
        {diff && <section aria-label="版本差异"><h3>版本与当前草稿的差异</h3>{diff.changes.length === 0 && <p>文件内容一致。</p>}{diff.changes.map(change => <button key={change.path} onClick={() => void run('比较文件', async () => { const value = await api<any>({ action: 'diff', workflowId: detail.draft.id, expectedRevision: detail.draft.revision, revisionId: diff.revisionId, path: change.path }); setDiff({ ...value, revisionId: diff.revisionId }); })}>{({ added: '新增', removed: '删除', changed: '修改' } as Record<string, string>)[change.kind]} {change.path}</button>)}{diff.path && <><p>{diff.path}</p><div className="wd-wfe-diff"><label>发布版本<textarea readOnly value={diff.before?.content ?? '文件不存在'} /></label><label>当前草稿<textarea readOnly value={diff.after?.content ?? '文件不存在'} /></label></div></>}</section>}
        {[...detail.revisions].reverse().map(revision => <div className="wd-wfe-version" key={revision.id}><strong>{revision.kind === 'trial' ? '试运行快照' : '发布版本'} · {revision.name}</strong><p className="wd-workflow-note">{revision.id}<br />{revision.createdAt} · 文件摘要 {revision.digest.slice(0, 12)}</p>
          <button disabled={dirty || !!busy} onClick={() => void run('查看版本', async () => { setDetail(await api<WorkflowDetail>({ action: 'get', workflowId: detail.draft.id, revisionId: revision.id })); setTab('files'); })}>查看版本文件</button>
          {!detail.readonly && <button disabled={dirty || !!busy} onClick={() => void run('比较版本', async () => { setDiff({ ...await api<any>({ action: 'diff', workflowId: detail.draft.id, expectedRevision: detail.draft.revision, revisionId: revision.id }), revisionId: revision.id }); })}>比较当前草稿</button>}
          <button disabled={!!busy} onClick={() => void run('创建会话', () => start(detail.draft.id, revision.id))}>使用此版本</button>
          {!detail.readonly && revision.kind === 'published' && <button disabled={dirty || !!busy || detail.draft.publishedRevision === revision.id} onClick={() => void run('设默认版本', async () => { setDetail(await mutate<WorkflowDetail>('activate', { revisionId: revision.id })); setNotice('已切换默认版本，仅影响新会话。'); })}>设为默认 / 回滚</button>}
        </div>)}
      </>}
    </main></div>
  </div>;
}
