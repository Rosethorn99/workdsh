// WorkDSH adaptation of Langflow GenericNode input/body/output layout.
// Copyright (c) 2024 Langflow. MIT; see resources/langflow/LICENSE and source-manifest.json.
import * as React from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import type { WorkflowStage } from '../../workflows/authoring.js';
import { ConditionFields } from './ConditionFields.js';
import { Icon } from './Icon.js';
import type { CardData } from './types.js';

export function NodeCard({data,selected}: NodeProps<Node<CardData>>) {
  const stage=data.stage, execution=data.effective ?? stage?.execution, [collapsed,setCollapsed]=React.useState(false);
  const kind=data.entry?'entry':stage!.kind, patch=(values:Partial<WorkflowStage>)=>{if(stage&&!data.readonly)data.patch?.(stage.id,values);};
  const input=(label:string,value:string,update:(v:string)=>void,multiline=false)=> <label className="lf-field"><span>{label}</span>{multiline?<textarea aria-label={data.name+' '+label} className="nodrag nowheel" rows={3} disabled={data.readonly} value={value} onChange={e=>update(e.target.value)}/>:<input aria-label={data.name+' '+label} className="nodrag" disabled={data.readonly} value={value} onChange={e=>update(e.target.value)}/>}</label>;
  const step=stage?.gate?.step, title=step===undefined?data.name:((step?'Step '+step:'Gate 0')+' · '+data.name.replace(/^(Step\s+\d+|Gate\s+0)\s*[·:：]\s*/,''));
  const description=data.entry?'输入需求后，按已锁定的工作流版本执行。':stage?.component==='read-file'?'在授权工作区读取文件，由官方 Agent 生成可验收的结果。':stage?.component==='write-file'?'由官方 Agent 写入声明的文件，检查产出后继续。':kind==='branch'?'根据条件选择“是”或“否”路径。':kind==='approval'?'等待你审核真实交付结果，通过后继续。':kind==='check'?'检查真实文件、内容与产出回执。':kind==='end'?'结束本次路径并汇总验收记录。':'由原生 Agent 完成任务，支持专家、团队与工具。';
  return <div className="wd-ai-card lf-node" data-kind={kind} data-state={data.state} data-app-gen={step!==undefined||undefined} aria-label={'流程节点 '+data.name}>
    <NodeToolbar isVisible={selected&&!data.readonly&&!!stage} position={Position.Top}><div className="lf-node-toolbar nodrag"><button title="复制节点" aria-label={'复制 '+data.name} onClick={()=>data.duplicate?.([stage!.id])}>复制</button><button aria-label={'配置 '+data.name} onClick={()=>data.inspect?.(stage!.id,'capabilities')}>参数</button><button aria-label={'删除 '+data.name} onClick={()=>data.remove?.([stage!.id])}>删除</button></div></NodeToolbar>
    <header className="lf-node-header"><Icon kind={stage?.component?.includes('file')?'file':kind}/><strong title={title}>{title}</strong><button className="nodrag lf-collapse" aria-label={(collapsed?'展开 ':'收起 ')+data.name} onClick={()=>setCollapsed(!collapsed)}>{collapsed?'＋':'−'}</button></header>
    {!collapsed&&<><p className="lf-node-description">{description}</p><div className="lf-node-body">
      {data.entry&&<p className="lf-help">运行时填写本次需求。任务、审核和产出来自真实执行记录。</p>}
      {kind==='task'&&stage&&<>
        {input('任务指令',stage.prompt??'',v=>patch({prompt:v}),true)}
        <label className="lf-field"><span>{execution?.executor?.kind==='team'?'专家团':execution?.executor?.kind==='expert'?'专家':'执行主体'}</span><button className="lf-reference nodrag" onClick={()=>data.inspect?.(stage.id,'capabilities')}>{data.executor??(execution?.executor?.kind==='workflow'?'工作流角色':'继承工作流配置')}<Icon kind="chevron" size={13}/></button></label>
        {execution?.model&&<div className="lf-field"><span>语言模型</span><button className="lf-reference nodrag" onClick={()=>data.inspect?.(stage.id,'capabilities')}>{execution.model.provider} / {execution.model.model}</button></div>}
        {input(stage.component==='read-file'?'读取文件':'输入文件',(stage.inputs??[]).join('\n'),v=>patch({inputs:v?v.split('\n'):[]}),true)}
        {input(stage.component==='write-file'?'写入文件':'产出文件',(stage.outputs??[]).join('\n'),v=>patch({outputs:v?v.split('\n'):[]}),true)}
        <button className="lf-reference lf-tools nodrag" onClick={()=>data.inspect?.(stage.id,'capabilities')}><Icon kind="tool"/><span>Skills {execution?.skills?.length??0} · 工具连接器 {execution?.connectors?.requirements?.length??0}</span><Icon kind="chevron" size={13}/></button>
      </>}
      {kind==='branch'&&stage&&<ConditionFields stage={stage} readonly={data.readonly} patch={patch}/>}
      {kind==='check'&&stage&&input('产出文件',(stage.outputs??[]).join('\n'),v=>patch({outputs:v?v.split('\n'):[]}),true)}
      {stage?.gate&&<button className="lf-reference nodrag" onClick={()=>data.inspect?.(stage.id,'outputs')}>App-Gen 门禁 · {step===0?'目标回读':'Step '+step}<Icon kind="chevron" size={13}/></button>}
    </div></>}
    {!data.entry&&<Handle type="target" id="in" position={Position.Left} style={{top:collapsed?28:80}} isConnectable={!data.readonly} aria-label={data.name+' 输入端口'} title="阶段输入：在前置节点完成后执行"/>}
    <footer className="lf-node-outputs">
      <span className="lf-state"><i/>{data.state}</span>
      {kind==='branch'?<div className="lf-branch-outputs"><div>是<Handle type="source" id="whenTrue" position={Position.Right} isConnectable={!data.readonly} aria-label={data.name+' 是输出端口'}/></div><div>否<Handle type="source" id="whenFalse" position={Position.Right} isConnectable={!data.readonly} aria-label={data.name+' 否输出端口'}/></div></div>:kind!=='end'&&<div className="lf-output">{data.entry?'开始':kind==='approval'?'审核通过':'完成'}<Handle type="source" id="next" position={Position.Right} isConnectable={!data.readonly} aria-label={data.name+' 输出端口'}/></div>}
    </footer>
  </div>;
}
