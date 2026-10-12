import * as React from 'react';
import type { WorkflowCondition, WorkflowStage } from '../../workflows/authoring.js';
import { conditionOperators } from '../../workflows/conditions.js';

const operatorNames: Record<WorkflowCondition['operator'], string> = {equals:'等于',notEquals:'不等于',contains:'包含',startsWith:'开头是',endsWith:'结尾是',greaterThan:'大于',lessThan:'小于'};

export function ConditionFields({stage,readonly,patch}:{stage:WorkflowStage;readonly:boolean;patch:(values:Partial<WorkflowStage>)=>void}) {
  const condition=stage.condition;
  const update=(values:Partial<WorkflowCondition>)=>patch({file:undefined,condition:{source:'literal',input:'',operator:'equals',match:'',caseSensitive:true,...condition,...values}});
  const field=(label:string,value:string,change:(value:string)=>void,multiline=false)=><label className="lf-field"><span>{label}</span>{multiline?<textarea className="nodrag nowheel" rows={3} aria-label={stage.name+' '+label} disabled={readonly} value={value} onChange={e=>change(e.target.value)}/>:<input className="nodrag" aria-label={stage.name+' '+label} disabled={readonly} value={value} onChange={e=>change(e.target.value)}/>}</label>;
  return <>
    <label className="lf-field"><span>条件来源</span><select className="nodrag" aria-label={stage.name+' 条件来源'} disabled={readonly} value={condition?.source??'exists'} onChange={e=>e.target.value==='exists'?patch({condition:undefined,file:stage.file??'generated/condition/result.md'}):update({source:e.target.value as 'literal'|'file',input:''})}><option value="exists">文件存在</option><option value="literal">文本输入</option><option value="file">文件内容</option></select></label>
    {!condition?field('条件文件',stage.file??'',value=>patch({file:value})):<>
      {field(condition.source==='file'?'条件文件':'文本输入',condition.input,input=>update({input}),condition.source==='literal')}
      <label className="lf-field"><span>运算符</span><select className="nodrag" aria-label={stage.name+' 运算符'} disabled={readonly} value={condition.operator} onChange={e=>update({operator:e.target.value as WorkflowCondition['operator']})}>{conditionOperators.map(key=><option key={key} value={key}>{operatorNames[key]} · {key}</option>)}</select></label>
      {field('匹配文本',condition.match,match=>update({match}))}
      <label className="lf-check nodrag"><input type="checkbox" aria-label={stage.name+' 区分大小写'} disabled={readonly} checked={condition.caseSensitive} onChange={e=>update({caseSensitive:e.target.checked})}/>区分大小写</label>
    </>}
  </>;
}
