// Configure assets through the same authenticated services as the UI. Never sends model prompts.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve,dirname} from 'node:path';
import {createAppGenManifest,expertDefinition,expertRoles} from './app-gen-workflow-template.mjs';
const require=createRequire(new URL('../../../packages/plugins/skills/package.json',import.meta.url)),{zipSync}=require('fflate'),{stringify}=require('yaml');
const names=['app-gen','yiform-generator','flow-generator','magic-script'];
const url=new URL(process.argv[2]),skillRoot=resolve(process.argv[3]),out=resolve(process.argv[4]);
assert.equal(url.hostname,'127.0.0.1');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie,'local auth cookie');
const call=async(path,endpoint,payload={})=>{const r=await fetch(url.origin+'/api/'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({endpoint,payload})});const e=await r.json();assert.ok(r.ok&&e.ok,JSON.stringify(e));return e.value;};
const expert=(e,p)=>call('workdsh-experts',e,p),wf=p=>expert('workflow-authoring',p),skill=(e,p)=>call('workdsh-skills',e,p);
const scan=async(root,prefix='')=>{const files={};for(const e of await readdir(join(root,prefix),{withFileTypes:true})){if(['node_modules','__pycache__','.git','.DS_Store'].includes(e.name)||e.name.startsWith('backup-')||e.name.includes('.bak'))continue;const p=prefix?prefix+'/'+e.name:e.name;assert.ok(!e.isSymbolicLink(),'source symlink '+p);if(e.isDirectory())Object.assign(files,await scan(root,p));else if(e.isFile())files[p]=await readFile(join(root,p));}return files;};
await mkdir(out,{recursive:true});
const source={},sourceManifest={format:'app-gen-skill-sources',version:1,excluded:['historical backup copies','.bak files','__pycache__','node_modules','.DS_Store'],skills:{}};
for(const name of names){const files=await scan(join(skillRoot,name));assert.equal(Object.keys(files).filter(p=>p.endsWith('SKILL.md')).length,1);source[name]=files;sourceManifest.skills[name]={root:join(skillRoot,name),files:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,sha(b)]))};for(const [p,b]of Object.entries(files)){const target=join(out,'source-skills',name,p);await mkdir(dirname(target),{recursive:true});await writeFile(target,b);}}
await writeFile(join(out,'source-manifest.json'),JSON.stringify(sourceManifest,null,2)+'\n');
let installed=await skill('list');
for(const name of names){if(!installed.some(s=>s.name===name)){const archive=zipSync(Object.fromEntries(Object.entries(source[name]).map(([p,b])=>[name+'/'+p,b])));const r=await fetch(url.origin+'/api/workdsh-skills/import',{method:'POST',headers:{cookie,'x-workdsh-file-name':encodeURIComponent(name+'.zip')},body:archive});const staged=await r.json();assert.ok(r.ok&&staged.ok,JSON.stringify(staged));await skill('commit-import',{id:staged.value.id,scope:'profile'});}
  const detail=await skill('detail',{name});assert.ok(detail.directoryPath,'frozen Skill source required');for(const [p,b]of Object.entries(source[name]))assert.equal(sha(await readFile(join(detail.directoryPath,p))),sha(b),'installed source differs: '+name+'/'+p);}
const workflowList=await wf({action:'list'});let draft;
const previous=JSON.parse(await readFile(join(out,'installation.json'),'utf8').catch(()=>'{"experts":{}}'));
if(previous.workflow?.id){draft=await wf({action:'get',workflowId:previous.workflow.id});assert.equal(draft.draft.revision,previous.workflow.draftRevision,'workflow changed since last configuration; preserve UI edits');}
else {assert.ok(!workflowList.some(w=>w.name==='App-Gen · YiForm 企业应用交付'),'existing App-Gen workflow requires explicit selection');draft=await wf({action:'copy',workflowId:'workdsh-ai-webapp',operationId:randomUUID()});}
const id=draft.draft.id,refs={};for(const name of names)refs[name]=await wf({action:'skill-revision',workflowId:id,skillId:name});
const state={...previous,skills:refs,workflow:{id,draftRevision:draft.draft.revision},experts:previous.experts??{},sourceManifest:'source-manifest.json'};
const save=()=>writeFile(join(out,'installation.json'),JSON.stringify(state,null,2)+'\n');await save();
const publish=async(key,definition)=>{if(state.experts[key]){const ref=state.experts[key];await expert('get',{expertId:ref.id,revisionId:ref.revision});return ref;}
  const existing=(await expert('list',{search:definition.name,limit:100})).items.filter(e=>e.name===definition.name&&e.origin==='personal');assert.equal(existing.length,0,'same-name expert exists; select explicitly');
  const d=await expert('create-draft',{definition,operationId:'app-gen-definition-'+sha(JSON.stringify(definition))});const v=await expert('validate',{expertId:d.expertId,draftRevision:d.revision});assert.ok(v.publishable,JSON.stringify(v));const c=await expert('request-publish-confirmation',{expertId:d.expertId,draftRevision:d.revision});const proof=await expert('confirm-publish',{confirmationToken:c.confirmationToken});const r=await expert('publish',{expertId:d.expertId,draftRevision:d.revision,dependencyLockDigest:v.dependencyLockDigest,proof,operationId:randomUUID()});const ref={id:d.expertId,revision:r.revision.revisionId,name:definition.name};state.experts[key]=ref;await save();return ref;};
for(const key of Object.keys(expertRoles))await publish(key,expertDefinition(key));
const root={...expertDefinition('architect'),name:'App-Gen 应用交付专家团',role:'App-Gen 阶段 Lead',description:'按 Gate 0 与严格九步，协调实施专家和独立证据审查，使用官方 Agent Teams。',
  methodology:'只协调当前阶段。创建官方 implementer/reviewer 与共享任务；审查任务 blockedBy 依赖实施任务。实施完成后独立审查，Lead 再调用 app-gen pass/validate；失败立即停止，不跨阶段写入。',
  team:{members:[{key:'implementer',definition:expertDefinition('architect')},{key:'reviewer',definition:expertDefinition('reviewer')}],workflows:[{id:'current-stage',title:'当前阶段交付',trigger:'工作流节点',deliverable:'真实文件与状态机证据',stages:[{id:'implementation',worker:'implementer',reviewer:'reviewer',dependsOn:[]}]}]}};
const team=await publish('team',root),catalog=await wf({action:'capability-catalog',workflowId:id});
const connectorRoles={yiform:['list_applications','get_application_detail','get_modular_detail'],dbx:['dbx_list_connections','dbx_describe_table'], 'magic-api':['get_resource_tree','get_api_details_by_id']};
const bindings={},missing=[];for(const [role,tools]of Object.entries(connectorRoles)){const matches=catalog.connectors.filter(c=>tools.some(t=>c.toolNames.some(n=>n.endsWith('__'+t))));assert.ok(matches.length<=1,'ambiguous connector role '+role);bindings[role]=matches[0]?.serverName??'unmapped-'+role;if(!matches.length)missing.push(role);}
const manifest=createAppGenManifest({skills:refs,experts:state.experts,team,connectors:bindings}),files={...draft.draft.files};
for(const p of Object.keys(files))if(p.startsWith('preset/skills/'))delete files[p];
for(const [name,resources]of Object.entries(source))for(const [p,b]of Object.entries(resources)){const text=b.toString('utf8');files['preset/skills/'+name+'/'+p]=!b.includes(0)&&Buffer.from(text).equals(b)?{encoding:'utf8',content:text}:{encoding:'base64',content:b.toString('base64')};}
let preset=files['preset/agent.cordis.yml'].content;
preset=preset.replace(/    (?:text|prefix): >-[\s\S]*?(?=\n- id: agent-instructions)/,'    text: >-\n      这是 App-Gen 企业应用工作流。Lead、实施或审查角色以当前节点分工为准；加载 app-gen，九步由 WorkDSH 顺序调度。\n      Gate 0 未确认禁止初始化。官方 Agent Teams 执行实施与独立审查；只在指定目标和授权范围内工作。\n      使用完整 yiform-generator、flow-generator、magic-script 的专业入口，不自行替代。\n      未通过真实状态机、证据审计及平台回读不能报完成。\n').replace('providerName: ai-product-development-skills','providerName: workdsh-app-gen-skills');
files['preset/agent.cordis.yml']={encoding:'utf8',content:preset};files['workflow.yaml']={encoding:'utf8',content:stringify(JSON.parse(JSON.stringify(manifest)),{lineWidth:0})};
files['layout.json']={encoding:'utf8',content:'{}\n'};files['app-gen-source-manifest.json']={encoding:'utf8',content:JSON.stringify(sourceManifest,null,2)+'\n'};
files['README.app-gen.md']={encoding:'utf8',content:'# App-Gen 企业应用工作流\n\n完整四套 Skills，Gate 0 + 9 步、3 个人工确认。每个 AI 节点有固定 Lead、阶段实施专家、独立审查专家，按官方任务依赖顺序执行。\n\n先在能力面板把 unmapped-yiform / unmapped-dbx / unmapped-magic-api 替换为本机真实连接器，并同步成员连接器范围，再校验、发布。全局已连接仍需阶段会话选中。\n\n运行时才确认真实 appId、数据库、dataSource、appKey 和 dry-run/apply；模板不含目标 ID 或凭据。run-context.json 固定实际 output/<appKey>/ 的 spec/state 路径；每阶段报告在 output/app-gen/，详细成果沿用项目已有编号目录并留存历史。\n\nv4 门禁调用固定 app-gen 的 pipeline_state.py validate，并检查当前及前置步骤全部 passed；人工审核目标、冻结规格与写入范围、最终交付。Python/Node/真实编译器/MCP 缺失均阻断。\n'};
const patches=Object.fromEntries([...new Set([...Object.keys(draft.draft.files),...Object.keys(files)])].filter(p=>JSON.stringify(draft.draft.files[p])!==JSON.stringify(files[p])).map(p=>[p,files[p]??null]));
draft=await wf({action:'save',workflowId:id,expectedRevision:draft.draft.revision,operationId:randomUUID(),patches});state.workflow.draftRevision=draft.draft.revision;state.connectorBindings=bindings;state.missingConnectors=missing;await save();
await writeFile(join(out,'workflow.yaml'),files['workflow.yaml'].content);await writeFile(join(out,'app-gen.workdsh-workflow.json'),JSON.stringify({format:'workdsh-workflow-bundle',version:1,sourceId:manifest.sourceId,upstream:draft.draft.upstream,files},null,2)+'\n');
const validation=await wf({action:'validate',workflowId:id,expectedRevision:draft.draft.revision});state.validation=validation;await save();
assert.ok(validation.issues.every(i=>i.field==='execution'&&i.message.startsWith('连接器需要本机映射：')),JSON.stringify(validation));
if(validation.ok){draft=await wf({action:'publish',workflowId:id,expectedRevision:draft.draft.revision,operationId:randomUUID()});state.workflow.draftRevision=draft.draft.revision;state.workflow.publishedRevision=draft.draft.publishedRevision;await save();}
console.log(JSON.stringify({workflow:state.workflow,stageCount:manifest.stages.length,experts:Object.keys(expertRoles).length,team:team.name,sourceFiles:Object.values(source).reduce((n,p)=>n+Object.keys(p).length,0),missingConnectors:missing,validation:validation.ok,notRun:['business application pipeline','external models','target writes']},null,2));
