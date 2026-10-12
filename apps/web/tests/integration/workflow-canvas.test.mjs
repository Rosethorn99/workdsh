import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editCanvas,validateCanvasDraft,horizontalLayout,defaultCanvasLayout,insertionPositions,entryNodeId} from '../../../../packages/plugins/experts/dist/workflows/canvas-operations.js';
import {presetDocument,validateStages} from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
const parse=t=>presetDocument(t).toJS();
const base=`# keep this author comment\nformat: workdsh-workflow\nversion: 2\nname: canvas\ndescription: ''\nmode: staged\nsourceId: fufan-ai-webapp\nentry: preset/agent.cordis.yml\nstart: first\ncustom: preserved\nstages:\n  - id: first\n    name: first\n    kind: task\n    prompt: write file\n    outputs: [first.md]\n    next: done\n    execution: {executor: {kind: expert, expertId: published, revisionId: locked}}\n  - id: done\n    name: done\n    kind: end\n`;
test('free canvas can save a detached draft, connect it and delete terminal nodes without pruning neighbours',()=>{
  let text=editCanvas(base,{type:'add',node:{id:'other',name:'Other',kind:'end'}}).text;
  validateCanvasDraft(parse(text));assert.throws(()=>validateStages(parse(text)),/到达/);
  text=editCanvas(text,{type:'disconnect',edge:{from:'first',port:'next',target:'done'}}).text;
  assert.equal(parse(text).stages[0].next,undefined);
  text=editCanvas(text,{type:'remove',ids:['done']}).text;
  assert.equal(parse(text).stages.length,2);
  text=editCanvas(text,{type:'connect',edge:{from:'first',port:'next',target:'other'}}).text;
  validateStages(parse(text));assert.match(text,/# keep this author comment/);assert.equal(parse(text).custom,'preserved');
});
test('multi-node copy preserves expert versions and remaps internal connections and deliverables only',()=>{
  const value=parse(editCanvas(base,{type:'duplicate',ids:['first','done'],copies:{first:'copy-task',done:'copy-end'}}).text);
  assert.equal(value.stages[2].next,'copy-end');assert.notEqual(value.stages[2].outputs[0],'first.md');
  assert.deepEqual(value.stages[2].execution,value.stages[0].execution);assert.equal(value.start,'first');
});
test('entry reconnection and edge reconnection are atomic and cycles are refused',()=>{
  let text=editCanvas(base,{type:'add',node:{id:'second',name:'second',kind:'task',prompt:'second',outputs:['second.md'],next:'done'}}).text;
  text=editCanvas(text,{type:'connect',edge:{from:'first',port:'next',target:'second'}}).text;
  assert.throws(()=>editCanvas(text,{type:'connect',edge:{from:'second',port:'next',target:'first'}}),/循环/);
  assert.throws(()=>editCanvas(text,{type:'connect',edge:{from:entryNodeId,port:'next',target:'done'}}),/AI 任务/);
  const moved=parse(editCanvas(text,{type:'connect',previous:{from:'first',port:'next',target:'second'},edge:{from:entryNodeId,port:'next',target:'second'}}).text);
  assert.equal(moved.start,'second');assert.equal(moved.stages[0].next,undefined);
});
test('horizontal layout supports separate branch ends and stable equal-depth rows',()=>{
  const m={start:'first',stages:[{id:'first',kind:'task',next:'branch'},{id:'branch',kind:'branch',whenTrue:'yes',whenFalse:'no'},{id:'yes',kind:'end'},{id:'no',kind:'end'}]};
  validateCanvasDraft(m);const p=horizontalLayout(m);assert.ok(p.first.x<p.branch.x);assert.equal(p.yes.x,p.no.x);assert.notEqual(p.yes.y,p.no.y);assert.ok(p[entryNodeId].x<p.first.x);
});
test('inline insertion leaves unrelated manual positions and existing node payloads intact',()=>{
  const m={start:'first',stages:[{id:'first',kind:'task',next:'branch'},{id:'branch',kind:'branch',whenTrue:'yes',whenFalse:'no'},{id:'yes',kind:'end'},{id:'no',kind:'end'}]};
  const saved={branch:{x:500,y:200},yes:{x:850,y:20},no:{x:820,y:520}};
  const p=insertionPositions(m,saved,{from:'branch',port:'whenTrue',target:'yes'},'added');
  assert.deepEqual(p.no,saved.no);assert.deepEqual(p.branch,saved.branch);assert.equal(p.added.y,saved.yes.y);assert.ok(p.yes.x-p.added.x>=384);
});

test('App-Gen opens all nine actual stage nodes in a compact canvas without changing execution edges',()=>{
  const stages=[{id:'gate-0',kind:'task',gate:{kind:'app-gen',step:0},next:'target-review'}, {id:'target-review',kind:'approval',next:'step-01'}];
  for(let step=1;step<=9;step++)stages.push({id:'step-'+String(step).padStart(2,'0'),kind:'task',gate:{kind:'app-gen',step},next:step===9?'delivery-review':'step-'+String(step+1).padStart(2,'0')});
  stages.push({id:'delivery-review',kind:'approval',next:'done'},{id:'done',kind:'end'});
  const m={start:'gate-0',stages},before=structuredClone(m),p=defaultCanvasLayout(m);
  assert.deepEqual(m,before);
  assert.equal(Object.keys(p).length,stages.length+1);
  const core=stages.filter(n=>n.gate?.step>0);
  assert.equal(core.length,9);
  assert.ok(new Set(core.map(n=>p[n.id].y)).size>1,'nine stages must span rows rather than one long line');
  assert.ok(Math.max(...Object.values(p).map(n=>n.x))-Math.min(...Object.values(p).map(n=>n.x))<=1080,'the graph must fit a readable canvas width');
  for(const [a,ap]of Object.entries(p))for(const [b,bp]of Object.entries(p))if(a!==b)assert.ok(Math.abs(ap.x-bp.x)>=300||Math.abs(ap.y-bp.y)>=230,'actual node cards must not overlap');
});

test('App-Gen custom branches retain graph layout instead of being flattened into a pipeline',()=>{
  const m={start:'first',stages:[{id:'first',kind:'task',gate:{kind:'app-gen',step:1},next:'choice'},{id:'choice',kind:'branch',whenTrue:'yes',whenFalse:'no'},{id:'yes',kind:'end'},{id:'no',kind:'end'}]};
  assert.deepEqual(defaultCanvasLayout(m),horizontalLayout(m));
});
