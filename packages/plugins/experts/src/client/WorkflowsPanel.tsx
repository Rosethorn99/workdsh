import * as React from 'react';
import type { WorkflowCatalog, WorkflowStatus } from '../workflows/catalog.js';
import { WorkflowEditor, type WorkflowApi } from './WorkflowEditor.js';
import type { WorkflowDetail, WorkflowSummary } from '../workflows/authoring.js';
import { WorkflowCreateDialog } from './WorkflowCreateDialog.js';

interface Props {
  readonly load: (signal: AbortSignal) => Promise<WorkflowCatalog>;
  readonly start: (workflowId: string) => Promise<void>;
  readonly configure: (values: Record<string, string>) => Promise<void>;
  readonly toggleNavigation: () => void;
  readonly api: WorkflowApi;
  readonly startAuthored: (workflowId: string, revisionId?: string, input?: string) => Promise<void>;
  readonly openSession: (sessionId: string) => Promise<void>;
}
const css = `
.wd-workflows{height:100%;overflow:auto;padding:28px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.wd-workflows header{display:flex;align-items:center;gap:12px;margin-bottom:12px}.wd-workflows h1{font-size:24px;margin:0}.wd-workflows p{line-height:1.65}
.wd-workflow-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:16px;margin:24px 0}
.wd-workflow-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px}.wd-workflow-card h2{font-size:19px;margin:0}.wd-workflow-card p{margin:0}.wd-workflow-category,.wd-workflow-note{font-size:12px;opacity:.7}.wd-workflow-card .wd-workflow-deliverable{font-weight:600}.wd-workflows button{padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;color:inherit;background:var(--dsw-alias-bg-base)}.wd-workflows button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.wd-workflows a{color:var(--dsw-alias-label-primary)}.wd-workflows button:disabled{opacity:.5;cursor:default}.wd-workflow-actions{display:flex;gap:8px;margin-top:auto;padding-top:12px}.wd-workflows [role=alert]{color:var(--dsw-alias-state-error-primary)}
.wd-workflow-config{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;max-width:600px;margin:20px 0}.wd-workflow-config label{display:block;margin-bottom:14px}.wd-workflow-config input{display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:inherit}
.wd-workflows .wd-workflow-title{margin-bottom:20px}.wd-workflow-title h1{margin-right:auto}.wd-workflow-title-actions{display:flex;gap:9px;align-items:center}.wd-workflows .wd-workflow-primary{background:#737fe2;color:#fff;border-color:#737fe2;font-weight:600}.wd-workflows .wd-workflow-primary:hover:not(:disabled){background:#6471d8}.wd-workflow-import{display:none}.wd-workflow-section-title{display:flex;gap:12px;align-items:center;margin-top:28px}.wd-workflow-section-title h2{font-size:18px;margin:0}.wd-workflow-count{font-size:12px;opacity:.6}.wd-workflow-section-title input{margin-left:auto;width:min(260px,40%);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 12px;color:inherit;background:var(--dsw-alias-bg-layer-2)}.wd-workflow-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:32px;margin:18px 0;text-align:center}.wd-workflow-empty strong{display:block;font-size:16px}.wd-workflow-empty p{font-size:13px;opacity:.7;margin:10px 0 18px}.wd-workflow-grid{grid-template-columns:repeat(auto-fill,minmax(min(285px,100%),1fr))}.wd-workflow-actions{flex-wrap:wrap}.wd-workflows button:focus-visible,.wd-workflows input:focus-visible{outline:2px solid #7a89ef;outline-offset:2px}
@media(max-width:600px){.wd-workflows{padding:16px}.wd-workflow-grid{grid-template-columns:1fr}}
@media(max-width:650px){.wd-workflow-title{flex-wrap:wrap}.wd-workflow-title-actions{width:100%}.wd-workflow-title-actions .wd-workflow-primary{flex:1}.wd-workflow-section-title{flex-wrap:wrap}.wd-workflow-section-title input{width:100%;margin-left:0}}
`;

export function WorkflowsPanel({ load, start, configure, toggleNavigation, api, startAuthored, openSession }: Props) {
  const [catalog, setCatalog] = React.useState<WorkflowCatalog>();
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [version, refresh] = React.useReducer(value => value + 1, 0);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [fields, setFields] = React.useState({ FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_DEFAULT_OPEN_ID: '' });
  const [editor, setEditor] = React.useState<WorkflowDetail>();
  const [mine, setMine] = React.useState<WorkflowSummary[]>([]);
  const [mineLoaded, setMineLoaded] = React.useState(false), [createOpen, setCreateOpen] = React.useState(false), [search, setSearch] = React.useState('');
  const importInput = React.useRef<HTMLInputElement>(null);
  const [importBundle, setImportBundle] = React.useState<unknown>();
  const [importPreview, setImportPreview] = React.useState<{ name: string; files: string[]; validation: { ok: boolean; issues: { path: string; message: string }[] } }>();
  React.useEffect(() => {
    const controller = new AbortController(); setError('');
    load(controller.signal).then(value => { if (!controller.signal.aborted) setCatalog(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '工作流加载失败。'); });
    api<WorkflowSummary[]>({ action: 'list' }, controller.signal).then(value => { if (!controller.signal.aborted) { setMine(value); setMineLoaded(true); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '个人工作流加载失败。'); });
    return () => controller.abort();
  }, [load, api, version]);
  const open = async (id: string, copy = false) => {
    setBusy(id); setError('');
    try { setEditor(await api<WorkflowDetail>({ action: copy ? 'copy' : 'get', workflowId: id, ...(copy ? { operationId: window.crypto.randomUUID() } : {}) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '编辑器加载失败。'); } finally { setBusy(''); }
  };
  const run = async (workflow: WorkflowStatus) => {
    setBusy(workflow.id); setError('');
    try { await start(workflow.id); } catch(cause) { setError(cause instanceof Error ? cause.message : '工作流任务创建失败。'); } finally { setBusy(''); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('configure'); setError('');
    try { await configure(fields); setFields({ FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_DEFAULT_OPEN_ID: '' }); setConfigOpen(false); refresh(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : '飞书配置保存失败。'); }
    finally { setBusy(''); }
  };
  return <section className="wd-workflows">
    <style>{css}</style>
    <header className="wd-workflow-title"><button type="button" onClick={toggleNavigation} aria-label="切换导航">☰</button><h1>工作流</h1>{!editor && <div className="wd-workflow-title-actions"><button disabled={!!busy} onClick={() => importInput.current?.click()}>导入文件包</button><button className="wd-workflow-primary" disabled={!!busy} onClick={() => setCreateOpen(true)}>＋ 新建工作流</button></div>}</header>
    {editor ? <WorkflowEditor key={editor.draft.id} initial={editor} api={api} start={startAuthored} openSession={openSession} close={() => { setEditor(undefined); refresh(); }} copied={setEditor} /> : <>
    <p>创建自己的 AI 流程，或从内置工作流开始。用节点组合任务、专家团、技能与连接器。</p>
    <p className="wd-workflow-note">内置 Preset、Skill 与配套工具来自赋范 Studio，由 WorkDSH 适配。实际交付以文件、测试和外部操作回执为准。</p>
    {error && <p role="alert">{error} <button type="button" onClick={refresh}>重试加载</button></p>}
    {!catalog && !error && <p role="status">正在加载工作流…</p>}
    <input ref={importInput} className="wd-workflow-import" aria-label="导入工作流文件包" type="file" accept=".json" disabled={!!busy} onChange={event => {
      const file = event.target.files?.[0]; if (!file) return; setBusy('import'); setError('');
      void (async () => { try { if (file.size > 24 * 1024 * 1024) throw new Error('工作流文件包过大。'); const bundle = JSON.parse(await file.text()); const preview = await api<any>({ action: 'preview-import', bundle }); setImportBundle(bundle); setImportPreview(preview); } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败。'); } finally { setBusy(''); } })(); event.target.value = '';
    }} />
    {importPreview && <section className="wd-workflow-config"><h2>导入预览：{importPreview.name}</h2><p>{importPreview.files.length} 个文件 · {importPreview.validation.ok ? '配置校验通过' : '配置未通过校验'}</p>{importPreview.validation.issues.map((issue, i) => <p key={i} role="alert">{issue.path}：{issue.message}</p>)}<p>确认导入只创建个人草稿，不发布、不执行脚本或安装依赖。</p><button disabled={!!busy} onClick={() => { setBusy('import'); void api<WorkflowDetail>({ action: 'import', bundle: importBundle, operationId: window.crypto.randomUUID() }).then(value => { setEditor(value); setImportPreview(undefined); setImportBundle(undefined); }).catch(cause => setError(cause instanceof Error ? cause.message : '导入失败。')).finally(() => setBusy('')); }}>确认导入草稿</button>{' '}<button onClick={() => { setImportPreview(undefined); setImportBundle(undefined); }}>取消</button></section>}
    <div className="wd-workflow-section-title"><h2>我的工作流</h2><span className="wd-workflow-count">{mine.length} 个</span>{mine.length > 0 && <input type="search" aria-label="搜索我的工作流" placeholder="搜索名称或用途…" value={search} onChange={event => setSearch(event.target.value)} />}</div>
    {!mineLoaded && !error && <p role="status">正在加载个人工作流…</p>}
    {mineLoaded && !mine.length && <div className="wd-workflow-empty"><strong>从你的第一个 AI 工作流开始</strong><p>选择起步模板，再在画布上拖入节点、连接流程。</p><button className="wd-workflow-primary" disabled={!!busy} onClick={() => setCreateOpen(true)}>创建第一个工作流</button></div>}
    {mine.length > 0 && <div className="wd-workflow-grid">{[...mine].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).filter(row => (row.name+' '+row.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(row => <article className="wd-workflow-card" key={row.id} data-workflow-id={row.id}><h2>{row.name}</h2><p>{row.description || '点击编辑，配置节点任务与能力。'}</p><p className="wd-workflow-note">{row.publishedRevision ? '已有发布版本' : '草稿 · 尚未发布'}</p><div className="wd-workflow-actions"><button disabled={!!busy} onClick={() => void open(row.id)}>编辑</button><button disabled={!!busy || !row.publishedRevision} onClick={() => { setBusy(row.id); void startAuthored(row.id).catch(cause => setError(cause instanceof Error ? cause.message : '创建失败。')).finally(() => setBusy('')); }}>用于新会话</button></div></article>)}</div>}
    {mine.length > 0 && !mine.some(row => (row.name+' '+row.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <div className="wd-workflow-empty"><p>没有找到符合条件的工作流。</p><button onClick={() => setSearch('')}>清空搜索</button></div>}
    <h2>内置工作流</h2>
    {configOpen && <form className="wd-workflow-config" onSubmit={save}>
      <h2>配置飞书数字员工</h2>
      <p className="wd-workflow-note">凭据写入当前 Host 的官方凭据服务；页面不会读取已保存的值。请确保自建应用已获得创建任务的权限。</p>
      {(['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_OPEN_ID'] as const).map(key => <label key={key}>{({ FEISHU_APP_ID: 'App ID', FEISHU_APP_SECRET: 'App Secret', FEISHU_DEFAULT_OPEN_ID: '默认负责人 open_id' })[key]}
        <input type={key === 'FEISHU_APP_SECRET' ? 'password' : 'text'} value={fields[key]} required maxLength={4096} autoComplete="off" onChange={event => setFields(value => ({ ...value, [key]: event.target.value }))} />
      </label>)}
      <button type="submit" disabled={!!busy}>{busy === 'configure' ? '保存中…' : '保存配置'}</button>{' '}
      <button type="button" disabled={!!busy} onClick={() => { setConfigOpen(false); setFields({ FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_DEFAULT_OPEN_ID: '' }); }}>取消</button>
    </form>}
    {catalog && <div className="wd-workflow-grid">{catalog.workflows.map(workflow => <article className="wd-workflow-card" key={workflow.id} data-workflow-id={workflow.id}>
      <span className="wd-workflow-category">{workflow.category}</span><h2>{workflow.name}</h2>
      <p>{workflow.description}</p><p className="wd-workflow-deliverable">{workflow.deliverable}</p>
      <details><summary>查看能力与前置条件</summary><p>角色：{workflow.role}</p><p>Skill：{workflow.skills.join('、')}</p><p>{workflow.requirements}</p></details>
      <p className="wd-workflow-note">{workflow.broken ? '暂不可用：' + workflow.broken : workflow.configured === false ? '需配置飞书凭据' : 'Preset 已就绪；执行前请核对前置条件'}</p>
      <div className="wd-workflow-actions"><button type="button" disabled={!!busy || !!workflow.broken || workflow.configured === false} onClick={() => void run(workflow)}>{busy === workflow.id ? '创建中…' : '用于新会话'}</button>
      <button disabled={!!busy} onClick={() => void open(workflow.id)}>查看文件</button><button disabled={!!busy} onClick={() => void open(workflow.id, true)}>复制并编辑</button>
      {workflow.id === 'workdsh-feishu-digital-employee' && <button type="button" disabled={!!busy} onClick={() => setConfigOpen(true)}>配置飞书</button>}</div>
    </article>)}</div>}
    {catalog && <p className="wd-workflow-note">来源：<a href={catalog.repository + '/tree/' + catalog.commit + '/apps/desktop/resources/preset-square'} target="_blank" rel="noreferrer">赋范 Studio 七套工作流</a> · {catalog.license} · 共 {catalog.workflows.length} 套</p>}
    {createOpen && <WorkflowCreateDialog api={api} close={() => setCreateOpen(false)} created={value => { setCreateOpen(false); setSearch(''); setEditor(value); }} />}
    </>}
  </section>;
}
export function WorkflowNavigationIcon() { return <span aria-hidden="true">◎</span>; }
