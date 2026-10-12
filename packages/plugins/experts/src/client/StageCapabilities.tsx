import * as React from 'react';
import { StageTeamEditor } from './StageTeamEditor.js';
import type { StageExecution, CapabilityCatalog } from '../workflows/authoring.js';
import type { SkillRevisionRef } from 'workdsh-contracts';
import type { WorkflowApi } from './WorkflowEditor.js';
import { remapStageConnector } from '../workflows/connector-mapping.js';

export function StageCapabilities({value,effective,catalog,change,api,workflowId,readonly,onError}:{value:StageExecution;effective:StageExecution;catalog?:CapabilityCatalog;change:(v:StageExecution)=>void;api:WorkflowApi;workflowId:string;readonly:boolean;onError:(e:string)=>void}) {
  const [search,setSearch]=React.useState(''),[busy,setBusy]=React.useState(false);
  const live=React.useRef({value,change,onError});live.current={value,change,onError};
  const mounted=React.useRef(true);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const kind=value.executor?.kind??'inherit', chosen=value.executor?.kind==='expert'||value.executor?.kind==='team'?value.executor:undefined;
  const experts=catalog?.experts.filter(e=>e.kind===kind&&(e.name+' '+e.description).toLowerCase().includes(search.toLowerCase()))??[];
  const selected=catalog?.experts.find(e=>e.id===chosen?.expertId&&e.revisionId===chosen?.revisionId);
  const update=(patch:Partial<StageExecution>)=>change({...value,...patch});
  const connectorValue=value.connectors??{mode:'inherit' as const}, requirements=connectorValue.requirements??[];
  return <div><label>执行主体<select aria-label="阶段执行主体" disabled={readonly} value={kind} onChange={e=>{
    const k=e.target.value;
    if(k==='inherit') update({executor:undefined,team:undefined});
    else if(k==='workflow') update({executor:{kind:'workflow'},team:undefined});
    else { const first=catalog?.experts.find(r=>r.kind===k); if(!first){onError('暂无可用的已发布'+(k==='team'?'专家团':'专家')+'，请先在专家目录发布。');return;} update({executor:{kind:k as 'expert'|'team',expertId:first.id,revisionId:first.revisionId},team:undefined}); }
  }}><option value="inherit">继承工作流默认</option><option value="workflow">使用原版工作流角色</option><option value="expert">指定专家</option><option value="team">指定专家团</option></select></label>
    {chosen&&<><input aria-label="搜索执行专家" placeholder="搜索名称或描述" value={search} onChange={e=>setSearch(e.target.value)}/><label>已发布专家与版本<select aria-label="选择专家版本" disabled={readonly} value={chosen.expertId+'|'+chosen.revisionId} onChange={e=>{const row=catalog?.experts.find(r=>r.id+'|'+r.revisionId===e.target.value);if(row)update({executor:{kind:row.kind,expertId:row.id,revisionId:row.revisionId},team:undefined});}}>
      {!experts.some(r=>r.id===chosen.expertId&&r.revisionId===chosen.revisionId)&&<option value={chosen.expertId+'|'+chosen.revisionId}>{selected?.name??chosen.expertId} · {chosen.revisionId.slice(-8)}</option>}
      {experts.map(r=><option key={r.id+r.revisionId} value={r.id+'|'+r.revisionId}>{r.name} · {r.revisionId.slice(-8)}</option>)}</select></label>
      {selected&&<div className="wd-stage-capabilities"><strong>{selected.name}</strong><p className="wd-stage-note">{selected.description}</p>{selected.members.map(m=><span className="wd-stage-pill" key={m}>{m}</span>)}<small className="wd-stage-note">固定版本：{selected.revisionId}</small></div>}</>}
    <StageTeamEditor value={value} effective={effective} catalog={catalog} api={api} workflowId={workflowId} change={change} readonly={readonly} onError={onError}/>
    <div className="wd-stage-capabilities"><strong>Skills</strong><p className="wd-stage-note">原版和专家必需技能完整保留；下面配置本阶段额外技能。</p>
      {(value.skills??[]).map(ref=><div className="wd-stage-files" key={ref.skillId}><span className="wd-stage-pill">{ref.name} · {ref.revisionId.slice(-8)}</span><button disabled={readonly} onClick={()=>update({skills:value.skills!.filter(r=>r.skillId!==ref.skillId)})}>移除</button></div>)}
      <select aria-label="添加阶段 Skill" disabled={readonly||busy} value="" onChange={async e=>{const id=e.target.value;if(!id)return;setBusy(true);try{const ref=await api<SkillRevisionRef>({action:'skill-revision',workflowId,skillId:id});if(mounted.current)live.current.change({...live.current.value,skills:[...(live.current.value.skills??[]).filter(r=>r.skillId!==ref.skillId),ref]});}catch(e){if(mounted.current)live.current.onError((e as Error).message);}finally{if(mounted.current)setBusy(false);}}}><option value="">{busy?'正在锁定技能…':'＋ 从已安装技能选择'}</option>{catalog?.skills.map(s=><option key={s.name} value={s.name} disabled={!s.selectable} title={s.reason}>{s.name}{s.selectable?'':' · '+(s.reason??'不可用')}</option>)}</select>
    </div>
    <div className="wd-stage-capabilities"><strong>连接器</strong><label>配置来源<select aria-label="阶段连接器模式" disabled={readonly} value={connectorValue.mode} onChange={e=>update({connectors:e.target.value==='inherit'?{mode:'inherit'}:{mode:'explicit',requirements:[...(effective.connectors?.requirements??[])]}})}><option value="inherit">继承工作流默认</option><option value="explicit">本阶段独立选择</option></select></label>
      {connectorValue.mode==='explicit'?<>{catalog?.connectors.map(c=>{const picked=requirements.find(r=>r.serverName===c.serverName);return <div key={c.serverName}><label className="wd-stage-checkrow"><input type="checkbox" disabled={readonly} checked={Boolean(picked)} onChange={e=>update({connectors:{mode:'explicit',requirements:e.target.checked?[...requirements,{serverName:c.serverName,required:true}]:requirements.filter(r=>r.serverName!==c.serverName)}})}/><span>{c.title}<small className="wd-stage-note"> · {c.state==='ready'?'已连接':c.state} · {c.toolNames.length} 个工具</small></span></label>{picked&&<label className="wd-stage-checkrow"><input type="checkbox" checked={picked.required} disabled={readonly} onChange={e=>update({connectors:{mode:'explicit',requirements:requirements.map(r=>r.serverName===c.serverName?{...r,required:e.target.checked}:r)}})}/>必需，未就绪时阻止执行</label>}</div>;})}
      {requirements.filter(r=>!catalog?.connectors.some(c=>c.serverName===r.serverName)).map(r=><div className="wd-stage-error" key={r.serverName}>{r.serverName} · 待映射
        <select aria-label={'映射阶段连接器 '+r.serverName} disabled={readonly||!catalog?.connectors.length} value="" onChange={e=>{if(e.target.value)change(remapStageConnector(value,effective,r.serverName,e.target.value));}}><option value="">选择对应本机连接器</option>{catalog?.connectors.map(c=><option key={c.serverName} value={c.serverName}>{c.title} · {c.serverName}</option>)}</select>
        <button disabled={readonly} onClick={()=>update({connectors:{mode:'explicit',requirements:requirements.filter(x=>x!==r)}})}>移除需求</button></div>)}{!requirements.length&&<p className="wd-stage-note">当前阶段不选择连接器。</p>}</>:<p className="wd-stage-note">有效选择：{effective.connectors?.requirements?.map(r=>r.serverName).join('、')||'无连接器'}</p>}
      <p className="wd-stage-note">将应用到实际阶段会话；全局已连接不等于会话已选中。连接器选择授予其完整工具集合。</p>
    </div>
    <details><summary>模型配置（高级）</summary><p className="wd-stage-note">默认继承官方会话模型。覆盖引用官方已配置的 provider/model，不填写密钥。</p><label>Provider<input disabled={readonly} value={value.model?.provider??''} onChange={e=>update({model:e.target.value?{provider:e.target.value,model:value.model?.model??''}:undefined})}/></label>{value.model&&<label>Model<input disabled={readonly} value={value.model.model} onChange={e=>update({model:{...value.model!,model:e.target.value}})}/></label>}</details>
    <p className="wd-stage-note">能力绑定在发布时锁定。修改不会影响已启动的运行。</p>{catalog?.diagnostics.map(d=><p className="wd-stage-note" key={d}>{d}</p>)}
  </div>;
}
