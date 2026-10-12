// The skills remain the source of truth. This file maps their nine steps to public workflow contracts.
export const appGenSteps = [
  {number:1,name:'应用规格与菜单标识',worker:'architect',connectors:['yiform','dbx'],skills:['app-gen'],refs:['pipeline.md','menu-write-recovery.md','persistence-gates.md'],
    task:'冻结需求、M/C/O 菜单树、主子表、字典/序列、能力需求、流程及验收库存。每个功能必须有 add/list。登记真实标识到 id-map.json；只形成 requirements-draft.md，不列猜测 API 路径。apply 冻结完整 schema-contract.json 及全部视图 deploymentContract。提交完整规格和证据，由 Lead 完成状态机 init、start/pass/validate Step 1。',
    artifacts:['app-spec.json','id-map.json','requirements-draft.md','schema-contract.json','evidence/step-01.json']},
  {number:2,name:'业务建模与 DDL',worker:'database',connectors:['dbx'],skills:['app-gen'],refs:['platform-contracts.md','persistence-gates.md'],
    task:'先回读目标库和系统对象，生成 sql/02-ddl.sql；主/子表固定 23/24 系统字段，业务字段 lowerCamelCase，COMMENT、索引、顺序完整。apply 按表执行幂等兼容 DDL 并逐表 describe；SQL_BLOCKED 时保留实际拒绝证据并 block Step 2，下游 pending，不绕过权限。不把静态 SQL 当建表完成。',
    artifacts:['sql/02-ddl.sql','schema-readback.json','evidence/step-02.json']},
  {number:3,name:'字典与流水号',worker:'database',connectors:['dbx','yiform'],skills:['app-gen'],refs:['platform-contracts.md'],
    task:'生成完整 sql/03-dictionary-sequence.sql，按唯一业务键幂等同步，字典值按 100 递增。所有单号字段映射真实 seq_id；不重置已有 current_number。apply 写后回读完整字典集合与序列规则，dry-run 不调用会消耗流水号的操作。',
    artifacts:['sql/03-dictionary-sequence.sql','dictionary-sequence-map.json','evidence/step-03.json']},
  {number:4,name:'接口发现与正式方案',worker:'api',connectors:['yiform','dbx','magic-api'],skills:['app-gen','magic-script'],refs:['api-contracts.md','capability-decisions.md','tools-current.md'],
    task:'逐动作发现当前源码/真实编译产物、YiPass 动态按钮和 Magic-API 资源树，优先配置/复用公共能力；只对明确缺口设计定制接口。记录真实 groupId/resourceId、sourceRef、鉴权、参数、事务、异常、幂等和顶层调试证据。Magic-Script 先读 SKILL.md 和 business-rules.md、核验目标语法；定制发布按实际目标及 diff 获得确认。生成 capability-decisions.json、api-inventory.json；再生成 implementation-plan.md，运行 validate_api_inventory.py。planned-blocked/proposed 不等于部署成功，不能通过 apply 门禁。',
    artifacts:['capability-decisions.json','api-inventory.json','implementation-plan.md','evidence/step-04.json']},
  {number:5,name:'模块菜单与物理表绑定',worker:'platform',connectors:['yiform','dbx'],skills:['app-gen'],refs:['menu-write-recovery.md','platform-contracts.md'],
    task:'使用真实模板及 ID，幂等绑定模块、O 菜单、物理表和数据源，写后回读。menuId/formMenuId=当前 O menu_id，flowCode=功能 C parentMenuId。add/list 同实体、不同 O menuId。64 位 ID 用字符串；500/超时先按稳定业务键回读，不能盲目重建菜单。',
    artifacts:['binding-manifest.json','evidence/step-05.json']},
  {number:6,name:'YiForm add/list 双视图',worker:'form',connectors:['yiform'],skills:['app-gen','yiform-generator'],refs:['yiform-contracts.md'],
    task:'先读 yiform-generator，选择 routine-session-draft 或 reference-blueprint，用公开 generate-yiform.mjs / validate-yiform-output.mjs 和真实 YiForm 编译器验证全部 add/list。两视图均 ok=true、verification.ok=true、无 unresolved；完整原生工具栏、动态 optionsDict、主子表、字段/组件和动作库存。保存 forms、manifest、expectations 和验证报告；不能直接手写复杂 options 或用 JSON 解析替代真实编译。',
    artifacts:['forms/','form-manifest.json','form-verification.json','evidence/step-06.json']},
  {number:7,name:'YiFlow 严格生成与保存',worker:'flow',connectors:['yiform'],skills:['app-gen','flow-generator'],refs:['yiflow-contracts.md'],
    task:'确认真实审批人、字段、数据源和 flowCode，使用 flow-generator 生成 canonical Turbo flowElementList，再运行 validate_flow.py --strict。apply 按授权保存并回读；启用需独立明确授权，再回读 isUse。无流程需求仍 start Step 7，留完整不适用证据，不造流程、不填假审批人。',
    artifacts:['flows/','flow-verification.json','evidence/step-07.json']},
  {number:8,name:'SFC 与模块持久化',worker:'platform',connectors:['yiform','dbx'],skills:['app-gen','yiform-generator'],refs:['yiform-contracts.md','persistence-gates.md'],
    task:'对最终全部 add/list 使用官方 genSFCWithModuleSplit，解析 JS、编译 Vue 模板并检查 click 绑定。apply 持久化完整 yiFormJson、yiFormJsonTable、html/js/css/sqlContent、真实绑定和流程关系，逐视图回读并与本地哈希比较，再核对完整 publish 列表。HTML/JS 不为空、CSS 非 NULL、menu_code 与菜单一致。仅有本地 JSON/SFC 或只保存绑表不算完成。请求契约漂移须从 Step 4 重基线。',
    artifacts:['sfc/','view-artifacts.json','module-readback.json','publish-readback.json','evidence/step-08.json']},
  {number:9,name:'运行验收与交付',worker:'acceptance',connectors:['yiform','dbx','magic-api'],skills:['app-gen'],refs:['preflight.md'],
    task:'按真实运行 URL、身份、验收库存核对列表/搜索/新增/保存/详情/编辑/逻辑删除、字典、流水号；有流程时验证发起、状态和下一节点，覆盖失败/并发/幂等用例。保存脱敏接口和数据回读；截图不能替代这些证据。9 步全部 passed 且 pipeline_state.py validate 为 0 才交付 delivery-report.md，分列生成、校验、保存、启用、发布和运行验收的实际证据，未执行如实说明。',
    artifacts:['acceptance-report.json','delivery-report.md','evidence/step-09.json']},
];

export const expertRoles = {
  architect:['App-Gen 需求与标识专家','核对目标，冻结完整业务规格、菜单库存与真实 ID。',['app-gen']],
  database:['App-Gen 数据建模专家','负责目标结构、幂等建表、字典和流水号的实际回读。',['app-gen']],
  api:['App-Gen API 与集成专家','发现真实 API 契约，优先复用公共能力，审查定制服务。',['app-gen','magic-script']],
  platform:['App-Gen 平台配置发布专家','负责模块菜单绑定、官方编译、JSON/SFC 持久化和发布回读。',['app-gen','yiform-generator']],
  form:['App-Gen YiForm 页面专家','使用公开专业生成器交付全部 add/list 与真实编译证据。',['app-gen','yiform-generator']],
  flow:['App-Gen YiFlow 流程专家','使用 canonical YiFlow、真实审批身份与 strict 校验，按授权保存/启用。',['app-gen','flow-generator']],
  acceptance:['App-Gen 运行验收专家','验证真实运行态、数据与失败路径，形成可审计交付结论。',['app-gen']],
  reviewer:['App-Gen 独立证据审查专家','独立核对前置状态、规格哈希、实际回读与专业验证；执行审计后由 Lead pass。',['app-gen','yiform-generator','flow-generator','magic-script']],
};

export function expertDefinition(key) {
  const [name,role,skills]=expertRoles[key];
  return {name,role,description:role,methodology:'读取固定版本 Skill。只执行当前阶段；核对输入 → start → 实施 → 回读 → 审计 → evidence → pass → validate。使用官方 Team 任务板，失败明确 block 并汇报 Lead。',
    boundaries:'不得跨阶段写入、猜测 ID/API、覆盖历史或绕过工具权限。dry-run 禁止远程写入；apply 仅限用户确认目标与范围。凭据不进入文档。独立审查先等待实施任务完成，不与实施成员同时写目标对象。',
    deliverables:'本阶段实际文件、evidenceVersion=2、脱敏回读和审查结论；使用已有项目及编号资料目录，保留历史。',tags:['App-Gen','YiForm'],examples:[{id:'current-stage',prompt:'执行当前 app-gen 阶段，交付真实文件并独立验证证据。'}],skillRequirements:skills.map(name=>({name})),futureRequirements:[]};
}

export function createAppGenManifest({skills,experts,team,connectors}) {
  const context='output/app-gen/run-context.json', stages=[];
  const execution=(worker,task,names,required,step=0)=>({executor:{kind:'team',expertId:team.id,revisionId:team.revision},skills:names.map(n=>skills[n]),
    connectors:{mode:'explicit',requirements:required.map(role=>({serverName:connectors[role],required:true}))},
    team:{lead:{expert:{expertId:team.id,revisionId:team.revision},goal:'仅协调当前节点，创建官方任务及顺序依赖；Lead 唯一维护 pipeline-state，核对真实产出和独立审查后 pass/validate，失败 block；不得推进其他节点。'},strategy:'sequential',members:[
      {key:'implementer',expert:{expertId:experts[worker].id,revisionId:experts[worker].revision},role:expertRoles[worker][0],task:'仅实施、回读和写证据；pipeline-state 的 init/start/pass/block 由 Lead 维护。'+task,skills:names.map(n=>skills[n]),connectors:required.map(r=>connectors[r])},
      {key:'reviewer',expert:{expertId:experts.reviewer.id,revisionId:experts.reviewer.revision},role:'独立证据审查',task:step===0?'等待实施任务完成，仅核对真实 appId↔databaseName、dataSource、执行范围和来源证据，出具目标核验结论给 Lead 和用户；此时禁止初始化或校验未建立的状态机。':'等待 implementer 官方任务完成，再核对当前阶段真实文件、目标、前置状态与 evidenceVersion=2；运行 app-gen audit-evidence.mjs 和 pipeline_state.py validate，Step 4 复跑 API 文档校验。发现问题向 Lead 提交明确阻断原因，不修改 pipeline-state、不填假 passed。通过后由 Lead 完成本阶段 pass/validate。',skills:names.map(n=>skills[n]),connectors:required.map(r=>connectors[r])}]}});
  const protocol='加载完整 app-gen Skill 并读 pipeline、execution-protocol、persistence-gates、tool-routing。读取 '+context+' 中真实 spec/state 路径，真实业务产物放 output/<appKey>/ 并关联项目已有编号目录。平台每阶段报告放 output/app-gen/。每次恢复先 validate，不修改冻结 spec。工作区只用本项目；终止或 blocked 时下游 pending。禁止物理删除、假 ID/API、凭据入文档。按官方 Team 创建 implementer/reviewer，reviewer 的 blockedBy 依赖实施任务。Lead 唯一维护 pipeline-state，委派前 start，审查通过后 pass/validate，失败 block；Gate 0 不初始化状态机。';
  const gateTask='仅做澄清和只读发现：确认业务目标及真实 appId ↔ databaseName、独立 dataSource、appKey、目标连接、YiForm 源码根和 dry-run/apply 范围。未知就询问，不能初始化状态机。保存 run-context.json，version=1，包含 appKey/dataSource/executionMode、spec/state 工作区相对路径及 targetConfirmation{appId,databaseName,confirmed:true,source:user|environment-readback,evidenceRefs:[{path,sha256}]}。来源文件保存真实脱敏回读或用户确认，禁止编造。汇总 00-target-confirmation.md 供用户审核，尚未执行业务写入。';
  stages.push({id:'gate-0',name:'Gate 0 · 目标环境核验',kind:'task',prompt:protocol+'\n'+gateTask,outputs:[context,'output/app-gen/00-target-confirmation.md'],gate:{kind:'app-gen',step:0,context},execution:execution('architect',gateTask,['app-gen'],['yiform','dbx']),next:'target-review'});
  stages.push({id:'target-review',name:'确认目标与执行范围',kind:'approval',next:'step-01'});
  for(const s of appGenSteps){const nn=String(s.number).padStart(2,'0'),report='output/app-gen/'+nn+'-stage-report.md';const task=s.task+'\n先阅读 app-gen references/'+s.refs.join('、references/')+'。实际产物库存：'+s.artifacts.join('、')+'；详细库存依业务规格扩展，不可省略。报告 '+report+' 必须列出全部实际文件及哈希、工具调用、回读、校验退出码和未执行项。';stages.push({id:'step-'+nn,name:'Step '+s.number+' · '+s.name,kind:'task',prompt:protocol+'\n'+task,inputs:[context,...(s.number===1?[]:['output/app-gen/'+String(s.number-1).padStart(2,'0')+'-stage-report.md'])],outputs:[report],gate:{kind:'app-gen',step:s.number,context},execution:execution(s.worker,task,s.skills,s.connectors,s.number),next:s.number===1?'spec-review':s.number===9?'delivery-review':'step-'+String(s.number+1).padStart(2,'0')});}
  stages.splice(3,0,{id:'spec-review',name:'确认规格与写入授权',kind:'approval',next:'step-02'});
  stages.push({id:'delivery-review',name:'交付人工验收',kind:'approval',next:'done'},{id:'done',name:'完成',kind:'end'});
  return {format:'workdsh-workflow',version:4,name:'App-Gen · YiForm 企业应用交付',description:'Gate 0 + 严格 9 步，完整专业 Skills，官方 Agent Teams 分工、真实状态机/证据门禁与人工确认。必需连接器须在本机映射后发布运行。',mode:'staged',sourceId:'fufan-ai-webapp',entry:'preset/agent.cordis.yml',start:'gate-0',stages};
}
