import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGraphOperation, graphEdges, automaticLayout, validateGraph, upstreamOutputs } from '../../../../packages/plugins/experts/dist/workflows/graph-operations.js';
import { presetDocument, validateStages } from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
const base = () => `# keep author comment\nformat: workdsh-workflow\nversion: 1\nname: example\ndescription: ''\nmode: staged\nsourceId: fufan-ai-webapp\nentry: preset/agent.cordis.yml\nstart: first\ncustom: preserved\nstages:\n  - id: first\n    name: first\n    kind: task\n    prompt: complete task\n    outputs: [first.md]\n    next: done\n  - id: done\n    name: done\n    kind: end\n`;
const parse = text => presetDocument(text).toJS();
test('adding three stages before end rewires predecessors and preserves source fields', () => {
  let text = base();
  for (let i=0;i<3;i++) text=applyGraphOperation(text,{type:'insert',target:'done',kind:'task',id:'new-'+i}).text;
  const value=parse(text); validateGraph(value);
  assert.equal(value.stages.find(n=>n.id==='first').next,'new-0');
  assert.equal(value.stages.find(n=>n.id==='new-2').next,'done');
  assert.equal(value.stages.at(-1).id,'done'); assert.equal(value.custom,'preserved'); assert.throws(()=>validateStages(value),/任务说明/); assert.ok(text.includes('# keep author comment'));
});
test('delete splices edges, moving splices both locations, invalid changes keep input intact', () => {
  let text=applyGraphOperation(base(),{type:'insert',target:'done',kind:'task',id:'two'}).text;
  text=applyGraphOperation(text,{type:'insert',target:'done',kind:'task',id:'three'}).text;
  text=applyGraphOperation(text,{type:'move',id:'three',from:'first',port:'next'}).text;
  let value=parse(text); validateGraph(value); assert.equal(value.stages.find(n=>n.id==='first').next,'three'); assert.equal(value.stages.find(n=>n.id==='three').next,'two');
  text=applyGraphOperation(text,{type:'delete',id:'three'}).text; value=parse(text); validateGraph(value); assert.equal(value.stages[0].next,'two');
  assert.throws(()=>applyGraphOperation(text,{type:'connect',from:'two',port:'next',target:'first'}),/循环/);
  assert.throws(()=>applyGraphOperation(text,{type:'delete',id:'done'})); validateGraph(parse(text));
});
test('branch-local insertion and shared terminal insertion preserve all paths', () => {
  let text=applyGraphOperation(base(),{type:'insert',target:'done',kind:'branch',id:'condition'}).text;
  text=applyGraphOperation(text,{type:'insert',from:'condition',port:'whenTrue',kind:'task',id:'yes'}).text;
  let value=parse(text); validateGraph(value); assert.equal(value.stages.find(n=>n.id==='condition').whenFalse,'done');
  assert.throws(()=>applyGraphOperation(text,{type:'insert',target:'done',kind:'task',id:'ambiguous'}),/多条/);
  text=applyGraphOperation(text,{type:'insert',target:'done',all:true,kind:'task',id:'shared'}).text;
  value=parse(text); validateGraph(value); assert.equal(value.stages.find(n=>n.id==='yes').next,'shared'); assert.equal(value.stages.find(n=>n.id==='condition').whenFalse,'shared');
  const layout=automaticLayout(value); assert.ok(layout.shared.y>layout.yes.y); assert.ok(layout.done.y>layout.shared.y);
  assert.equal(graphEdges(value).filter(e=>e.target==='shared').length,2);
});
test('deleting a branch retains shared successors and before-start only accepts tasks',()=>{
  let text=applyGraphOperation(base(),{type:'insert',target:'done',kind:'branch',id:'condition'}).text;
  text=applyGraphOperation(text,{type:'insert',from:'condition',port:'whenFalse',kind:'task',id:'no'}).text;
  const out=applyGraphOperation(text,{type:'delete',id:'condition',keep:'whenTrue'}); validateGraph(parse(out.text)); assert.ok(out.removed.includes('no'));
  const first=applyGraphOperation(base(),{type:'insert',target:'first',kind:'task',id:'new-start'}); assert.equal(parse(first.text).start,'new-start');
  assert.throws(()=>applyGraphOperation(base(),{type:'insert',target:'first',kind:'approval',id:'bad'}),/起始/);
});

test('maximum 32-stage layout stays ordered and inputs only suggest ancestor outputs',()=>{
  let text=base();for(let i=0;i<30;i++)text=applyGraphOperation(text,{type:'insert',target:'done',kind:'task',id:'node-'+i}).text;
  const graph=parse(text),layout=automaticLayout(graph);validateGraph(graph);
  for(const edge of graphEdges(graph))assert.ok(layout[edge.target].y>layout[edge.from].y);
  assert.deepEqual(upstreamOutputs(graph,'first'),[]);
  assert.deepEqual(upstreamOutputs(graph,'node-1'),['first.md','generated/node-0/result.md']);
  assert.throws(()=>applyGraphOperation(text,{type:'insert',target:'done',kind:'task',id:'overflow'}),/32/);
});
