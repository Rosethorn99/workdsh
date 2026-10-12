import * as React from 'react';
import type { WorkflowDetail } from '../workflows/authoring.js';
import { workflowStarters, type WorkflowStarter } from '../workflows/starters.js';
import type { WorkflowApi } from './WorkflowEditor.js';

const css = `
.wd-create-workflow{width:min(580px,calc(100vw - 40px));max-height:calc(100dvh - 48px);box-sizing:border-box;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);box-shadow:0 24px 80px #0005;overflow:auto}
.wd-create-workflow::backdrop{background:#0007;backdrop-filter:blur(3px)}.wd-create-workflow form{padding:26px}.wd-create-workflow header{display:flex;align-items:flex-start;gap:12px;margin:0 0 22px}.wd-create-workflow h2{font-size:21px;margin:0 0 7px}.wd-create-workflow p{font-size:13px;line-height:1.6;margin:0;opacity:.72}.wd-create-workflow .wd-create-close{margin-left:auto;padding:4px 9px;font-size:20px}
.wd-create-workflow button{padding:9px 15px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;color:inherit;background:var(--dsw-alias-bg-layer-2)}.wd-create-workflow button:disabled{opacity:.5;cursor:default}.wd-create-workflow label{display:block;font-size:13px;font-weight:600}.wd-create-field{margin-bottom:18px}.wd-create-workflow input[type=text],.wd-create-workflow textarea{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}.wd-create-workflow textarea{resize:vertical;min-height:72px}.wd-create-workflow input:focus-visible,.wd-create-workflow textarea:focus-visible,.wd-create-workflow button:focus-visible{outline:2px solid #7a89ef;outline-offset:2px}
.wd-create-workflow fieldset{border:0;margin:0;padding:0;min-width:0}.wd-create-workflow legend{font-size:13px;font-weight:600;margin-bottom:9px}.wd-create-choices{display:grid;gap:10px}.wd-create-workflow .wd-create-choice{cursor:pointer;display:flex;align-items:flex-start;gap:10px;padding:15px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;font-weight:400;background:var(--dsw-alias-bg-layer-2)}.wd-create-choice[data-selected=true]{border-color:#7a89ef;box-shadow:inset 0 0 0 1px #7a89ef;background:color-mix(in srgb,#7a89ef 7%,var(--dsw-alias-bg-base))}.wd-create-choice input{margin-top:3px;accent-color:#737fe2}.wd-create-choice strong{font-size:14px}.wd-create-choice small{display:block;opacity:.65;line-height:1.55;margin-top:6px}.wd-create-preview{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px;font-size:11px}.wd-create-preview span{padding:4px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px}.wd-create-preview i{font-style:normal;opacity:.45}.wd-create-workflow footer{display:flex;align-items:center;justify-content:flex-end;gap:9px;margin-top:22px}.wd-create-workflow .wd-create-primary{color:#fff;background:#737fe2;border-color:#737fe2;font-weight:600}.wd-create-hint{margin-top:16px!important}.wd-create-workflow [role=alert]{color:var(--dsw-alias-state-error-primary);opacity:1;margin-top:14px}.wd-create-optional{font-weight:400;opacity:.6;margin-left:6px}
.wd-create-workflow{overflow:hidden}.wd-create-workflow form{padding:0;display:flex;flex-direction:column;max-height:calc(100dvh - 50px)}.wd-create-workflow header{padding:24px 26px 18px;margin:0;flex-shrink:0}.wd-create-body{overflow:auto;min-height:0;padding:0 26px 20px}.wd-create-workflow footer{flex-shrink:0;margin:0;padding:16px 26px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
`;

export function WorkflowCreateDialog({ api, created, close }: { api: WorkflowApi; created: (value: WorkflowDetail) => void; close: () => void }) {
  const dialog = React.useRef<HTMLDialogElement>(null), nameInput = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(''), [description, setDescription] = React.useState('');
  const [starter, setStarter] = React.useState<WorkflowStarter>('review');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const flight = React.useRef(false), mounted = React.useRef(false);
  const request = React.useRef<{ fingerprint: string; payload: Record<string, unknown> } | undefined>(undefined);
  React.useEffect(() => {
    mounted.current = true; const element = dialog.current!; element.showModal(); nameInput.current?.focus();
    return () => { mounted.current = false; element.close(); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (flight.current) return;
    if (!name.trim()) { setError('请填写工作流名称。'); nameInput.current?.focus(); return; }
    const fields = { name: name.trim(), description: description.trim(), starter }, fingerprint = JSON.stringify(fields);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, payload: { action: 'create-draft', ...fields, operationId: window.crypto.randomUUID() } };
    flight.current = true; setBusy(true); setError('');
    try { const value = await api<WorkflowDetail>(request.current.payload); if (mounted.current) created(value); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '创建失败，请重试。'); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="wd-create-workflow" aria-labelledby="wd-create-title" aria-describedby="wd-create-description" onCancel={event => { event.preventDefault(); if (!flight.current) close(); }}>
    <style>{css}</style><form onSubmit={submit} aria-busy={busy}>
      <header><div><h2 id="wd-create-title">新建工作流</h2><p id="wd-create-description">把你的工作方式编排成可复用的 AI 流程。</p></div><button type="button" className="wd-create-close" aria-label="关闭新建工作流" disabled={busy} onClick={close}>×</button></header>
      <div className="wd-create-body">{error && <p role="alert" style={{ margin: '0 0 14px' }}>{error}</p>}<fieldset disabled={busy}>
        <label className="wd-create-field">工作流名称<input ref={nameInput} type="text" required maxLength={120} placeholder="例如：MES 需求与设计流程" value={name} onChange={event => { setName(event.target.value); setError(''); }} /></label>
        <label className="wd-create-field">用途说明<span className="wd-create-optional">选填</span><textarea maxLength={4096} placeholder="这个流程要完成什么工作？" value={description} onChange={event => setDescription(event.target.value)} /></label>
        <fieldset><legend>选择起步方式</legend><div className="wd-create-choices">{workflowStarters.map(row => <label key={row.id} className="wd-create-choice" data-selected={starter === row.id}>
          <input type="radio" name="workflow-starter" value={row.id} checked={starter === row.id} onChange={() => setStarter(row.id)} /><div><strong>{row.name}</strong><small>{row.description}</small><div className="wd-create-preview" aria-hidden="true">{row.preview.map((text, i) => <React.Fragment key={text}>{i > 0 && <i>→</i>}<span>{text}</span></React.Fragment>)}</div></div>
        </label>)}</div></fieldset>
      </fieldset>
      <p className="wd-create-hint">下一步：拖入节点、连接流程，绑定 Skills、专家 / Agent Teams 或连接器。配置会保存为个人草稿。</p>
      </div>
      <footer><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="wd-create-primary" disabled={busy}>{busy ? '创建中…' : '创建并开始编排'}</button></footer>
    </form>
  </dialog>;
}
