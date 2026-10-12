# 公开领域与执行契约

本文件约束 WorkDSH 自有服务及其官方适配。实际 TypeScript 定义由 `packages/contracts` 与各包的公开入口拥有；未来草案不能当成官方 API。模块来源见 [ARCHITECTURE](ARCHITECTURE.md)，验收见 [ACCEPTANCE](ACCEPTANCE.md)。

## 身份、资源与授权

ActorContext 必须从 Host 可信身份解析；浏览器和模型传入的 principalId、organizationId、sessionId、路径或 scope 不作为授权证据。领域读取、修改、搜索、下载、预览、订阅及后台工具逐次校验实际资源归属。页面和 Agent 工具调用同一业务服务。

资源引用保存稳定对象 ID、所有者和精确修订；显示名称不作身份。Profile 仅选择插件与配置。AccessGrant、连接授权、官方 approval 与 runtime enforcement 分别判断，任一必要层缺失、撤权或不满足保证均失败关闭。

CredentialBinding 只表达凭据引用、连接实例、目标指纹与外部主体，不包含明文。执行时解析真实秘密并重新校验账号与 tool scope，轮换不能静默改变外部主体。日志、模型上下文、配置描述、导出与同步不能带入凭据。

## 领域所有权与修订


| 领域 | 服务意图与边界 |
| --- | --- |
| experts | 草稿、校验、发布、归档、解析执行；发布固定不可变修订 |
| skills | 发现、导入、创建、编辑、启停、卸载；官方 registry/provider 拥有运行目录 |
| connectors | 定义、实例、健康与发现、授权选择；官方 MCP/Tools/Credentials 拥有传输和运行 |
| library | 原件、检索、建议修订、接受与成果注册；拥有唯一正文 |
| projects | 配置修订、能力/资产关联、业务待办与活动；关联不授予源对象权限 |
| office | 授权工作副本、格式模型、人工租约、CAS 编辑与固定修订导出 |
| activity | 投影原生 Team 和持久领域事实，不复制执行状态机 |

修改与接受建议携带 expectedRevision，冲突拒绝静默覆盖。项目只保存资产与能力引用；移除关联不卸载源对象。归档和卸载保留历史引用或明确返回不可用诊断。列表和读取均按当前主体过滤，缓存不能改变授权结果。

## 执行绑定与会话事实

专家、应用或项目提供默认值，用户明确选择优先；组织限制始终单独约束。任务建立时固定专家/技能修订、preset 指纹、模型、项目、资产和连接账号。恢复、fork、交接及每个子任务重新解析身份、资源与执行授权，不能回退最新修订或其他连接账号。

WorkDSH 通过官方 preset、Session Controller、Agent 与 Team 公开接口执行，不另建 Agent loop。PromptReceipt 只表示持久入队；结果以原生 sessionId、durable cursor、turn/step 与工具结算读取。中断请求、mailbox 接受或 provider 移除不表示已停止，部分/未知结果不能宣称完整交付。

原生 Session 拥有消息、工具、步骤、运行审批与子 Agent 事实；业务待办、资产修订、组织授权和自动化由各领域拥有。原生工具或 Team 完成不能直接完成项目待办，成果须经过资料服务校验并返回修订引用。持久化读取、导出或交接前按官方机制 flush。

交接只传选定且接收方可读的摘要与资产；prepare 和 claim 均重查授权，不复制原私有会话历史。连接在接收方重新绑定，已发生的外部写入不重放。后台同步保存原 Session/Run 的成员与组织绑定，不用当前窗口账号替代。

## 外部提交与自动化

提供方声明幂等、查询与部分结果能力。提交回执包含操作 ID、外部记录 ID 与可读摘要；未知结果先核对，不把超时直接当失败重试。取消或撤权不能声称已完成外部副作用回滚。

自动化规则、持久幂等键与运行历史属于 automations；触发先保存 source/delivery/rule 事实，再协调原生 Session。HTTP 202、dispatch 或 Job terminal snapshot 都不能单独宣称业务运行完成。未实现的自动化与共享运行入口保持不可加载。

## 官方传输与生命周期

跨插件只消费公开 exports/types，不导入内部类或读取其他领域表。一元业务协议使用官方 Typert Remote；Host 签名为唯一来源，Client 消费生成类型，身份 lookup 不生成授权。可预期错误使用稳定 domain/reason code，不依赖错误消息或跨边界 instanceof。

技能管理使用官方 Client Connection 的精确 JSON/流式 Fetch route 适配当前生成器兼容限制；Host 校验 payload、来源、上传大小、中止与受控根。该适配不形成新的通用 transport。全局技能导入不冒用会话附件 receipt；导入只检查数据，拒绝穿越、符号链接与不合法 SKILL.md，确认后原子发布。

Agent 工具定义严格 schema、规范 JSON、模型内容和独立 UI presentation；原生与 PTC 调用经过同一 guard、授权、approval、审计和结算。工具尊重 exec.signal；发布后台 Job 后，取消和结算由 Job 生命周期拥有。

资源、Remote、监听、timer、watcher、连接与子进程由 Cordis Fiber 托管。可选服务缺失返回明确诊断；必需服务不可用时不能假成功。unload/reinstall 不残留贡献、工具、子进程或订阅。

## Office 与预览

Office 页面和工具使用同一已保存工作副本模型；样式、列表和 revision 更新通过严格 Host 校验。预览原件与原生编辑能力分别声明，不能承诺任意格式无损转换。HTML 在无 Host 与未授权网络能力的沙箱内展示。

content_export 授权读取已保存修订，baseRevision 不匹配返回冲突；稳定摘要路径的已有同字节文件可复用，不同字节不能覆盖。写入与交付组合官方 bash/present，继承 scope/token/signal；未知写入不交付，present 回执才可标记 presented。导出文件与工作副本修订分开，不冒充完整跨重启导出 Job 协议。

## 工作流制作与阶段验收

列表“新建工作流”调用 `workflow-authoring/create-draft`，输入 name（trim 后 1–120 字符）、可选 description（最多 4096 字符）、starter（review/blank，默认 review）及 operationId。同一主体的幂等请求只产生一份个人草稿；所有者由 Host 身份服务确定，创建授权、审计及原子持久化沿用 WorkflowEditor，不接受客户端 owner。它返回可编辑 WorkflowDetail，不注册运行 Preset、不创建会话、不发布。用户创建的 sourceId 固定为 workdsh-user-workflow，使用中性官方工具配置和显式空连接器选择；可选绑定技能，不要求复制内置 Skill。七套来源副本仍必须保留完整技能。完整包导入导出支持用户来源，空白与未连接草稿可保存和导入，但校验、试运行和发布必须拒绝不完整流程。

experts 包拥有工作流草稿、不可变发布版本与阶段验收检查点。七套来源 Preset、九个 Skill 及来源哈希保持原文；个人副本包含完整包及独立运行适配。workflow.yaml 声明名称、模式、模块入口和阶段连接，preset/agent.cordis.yml 拥有原生插件配置，layout.json 只保存布局。可视化与文件编辑必须写同一份内容，未知字段、分组、注释和平台表达式不丢失。

官方 Connection 的 workflow-authoring 操作提供 get/list/copy/save/validate/trial/publish/activate/create、版本差异、完整包导入导出及 runs/run-continue/run-approve/run-pause/run-resume/run-repair/run-submit/run-deliver。Host 解析身份并逐次授权，修改携带 expectedRevision 或 expectedRunRevision、operationId；冲突不覆盖，幂等重试不重复写入。导入不执行代码、安装依赖或创建运行；导出不含主体绑定及凭据。

`workflow-authoring/project-options` 输入 projectId，返回 binding（可选 workflowId/name）、workflows 和 blocked（可选原因）。Host 从已授权项目的当前配置读取 `本项目仅使用现有工作流“名称”（workflowId=wf-UUID）` 明确约束，普通参考文字不形成绑定；无效或重复约束报 workflows/project-binding-invalid。固定项目只返回原工作流；未发布草稿可见但不能从启动入口运行，缺失、归档或无权访问保持阻断。项目运行 create 及其幂等重试复核当前配置；选用其他流程在原生会话和运行状态写入前报 workflows/project-workflow-mismatch。任务历史继续引用创建时的配置修订。
archive/restore 通过相同授权、修订冲突、幂等和审计服务撤回或恢复个人工作流。归档前所有运行必须已暂停或完成；归档不删除文件、不可变版本、绑定或项目历史。默认 list 隐藏归档项，includeArchived=true 可读归档状态；get/export/runs 和历史会话仍可读，恢复前不可编辑、发布或继续运行。

发布冻结文件哈希、精确官方依赖、运行适配及编译后的 Preset。旧会话、子任务与阶段运行绑定原版本；从原生选择器选择未绑定自定义 Preset、切换绑定版本、执行已验收或暂停阶段必须拒绝。授权的会话读取通过 SessionAccess，创建和取消通过官方 Session 接口，不复制 Agent loop、Team 状态或消息表。

阶段图最多 32 个可达无环节点，起始节点为任务。任务回合成功结算且声明的非空新文件通过授权工作区路径和 SHA-256 检查后才可推进；已验收输入发生变化须退回修复。人工确认记录真实主体，分支读取真实文件，暂停只表示阻止业务推进并请求官方取消。历史手动运行重启后不自动提交；自动运行先持久化提交意图，以稳定 requestId 调用官方 Session Controller prompt，恢复后复用同一 ID，已接收的提示不重发；下一阶段会话创建失败使用原预留 ID 重试。模型文字、按钮和流程图均不能作为成果验收证据。

阶段能力使用 workflow.yaml v2 的默认 execution 与阶段 execution，v1 不接受能力字段。专家和专家团引用精确 expertId/revisionId；Skills 引用不可变 revision/contentDigest；连接器引用逻辑 serverName 及 required。发布冻结专家全量 Persona、成员角色及技能目录，同时完整保留原工作流 Persona、技能与插件；专家团成员只追加其自身角色、技能和本阶段补充技能，通过官方 Team 运行。连接器在真实阶段会话中逐项应用并读回，显式空集合不启用任何连接器。必需能力缺失进入待能力状态，恢复后复用原会话；已准备好的未执行会话显示待开始，不冒充成功或失败。目录接口不提供无可冻结源的内置 Skill 作为补充绑定。

`connector-catalog` 沿用工作流 read 授权，仅返回已安装连接器的目录元数据。校验逐阶段返回全部缺失必需连接器，问题携带 stageId、field=connectors、connectorName；发布拒绝携带完整 WorkflowValidation 与 draftRevision，不以零数量代替真实统计。客户端只接受当前未修改草稿的校验结果，失败后暂停发布与运行并允许重新校验。显式映射修改 YAML 中连接器需求和团队范围，合并重复需求时保留 required=true，不替换任务文字、门禁或图结构；服务端发布仍独立重新校验。

一次发布请求内，完整校验返回每个阶段的已解析能力；冻结 dependency-lock 与编译 native-stage 使用同一结果，禁止再次遍历完整专家团。Skill 保留按 skillId、revisionId、name、contentDigest 去重，覆盖阶段和全部 Team 角色依赖，使用本工作流发布修订的 consumer。结果仅存在于该请求内；后续发布、恢复与执行仍检查完整性、授权、来源启用状态和连接器就绪状态。保留或装载失败不得提交发布状态。

验证页选择的映射属于编辑器未保存状态；save/validate 先将其合并到当前本地 workflow.yaml 补丁，通过 expectedRevision 保存后再使用返回的新修订校验。待保存状态不会标为“草稿已保存”，离开保护覆盖这些选择；保存失败保留已经转换的文件补丁。映射面板“保存映射并校验”与顶部“校验”使用同一保存路径，不增加第二份绑定配置。

自由画布允许断线草稿和多结束节点。批量删除只移除选中节点及相关连线，复制重映射内部连线和文件，保留固定能力版本。运行前完整校验不变。create 的 automatic=true 与非空 input 是用户显式启动自动模式的请求；未带此参数的历史/兼容调用保持手动。Host 串行 CAS 调度，页面离开不停止已授权的运行，人工审核、失败、暂停和能力缺失阻止后续提交。



workflow.yaml v5 新增 branch.condition（literal/file、input、七种明确比较 operator、match、caseSensitive）与 task.component（agent/read-file/write-file）。旧 Schema 拒绝这些字段。条件仍由原工作流调度器推进，不执行脚本或表达式；文件内容读取限定授权 cwd、至多 1 MiB UTF-8 文本、拒绝链接并记录 SHA-256 回执。读取与写入组件是官方 Agent 的任务配方，不是 Langflow Python 执行器。节点、属性栏及 YAML 共用草稿；注释与视口仅写 layout.json，整组移动或删除原子保存且支持撤销。Langflow 的可分离源码与布局参考固定版本、保留原文及 MIT 许可；完整子流程、RAG 和 Playground 不由本适配宣称支持。

## 项目内工作流与阶段 Agent Teams

workflow.yaml v3 在阶段 execution.team 中声明 Lead 的精确专家修订和目标、1–8 位成员的唯一 key、专家修订、角色、任务、附加 Skill 修订和连接器范围，以及 parallel/sequential 策略。stage executor 仍需绑定一个已发布专家团；自定义 Lead 和成员引用均必须可授权解析，成员不能嵌套专家团。成员连接器只可缩小阶段范围，不提升权限。v1/v2 不接受 team 字段，避免旧解释器静默忽略分工。可视化配置和在线 YAML 修改共享同一草稿；发布冻结所有角色的组合摘要及技能引用。旧运行不会读取新草稿。

Lead 使用官方 spawn_teammate、Team 任务板与 mailbox 推进本阶段；WorkDSH 不持有第二份 roster/task/mailbox。run-team 是授权只读投影，读取官方实时或持久事实。人工/自动验收均要求 Lead 成功结算、配置成员实际创建并成功结算、各成员至少一个已完成分配任务、全部实际任务完成以及新产出文件核验。顺序策略还需存在官方 blockedBy 依赖链；完成回合或只填配置不能跳过这些条件。暂停请求官方 Lead/成员取消并阻止业务推进，中断请求不冒充执行已经停止。

ProjectTaskLink.workflow 固定 workflowId/revisionId/runId/stageId；每个阶段会话通过公开 ProjectService.linkTask 关联同一项目配置修订和输入引用。配置不属于该项目、会话被关联其他项目或引用已失效时拒绝。官方成员 Session 的父链只在同主体、同工作目录及可授权检查通过后继承项目上下文。资产仍由资料库拥有。项目待办不随阶段自动完成。

projects 在 workdsh.project.detail 根级 Factory 中唯一声明 workdsh.project.workflow 子槽；项目面板与任务会话复用该 Factory。experts 贡献项目计划/任务/启动界面及 workdsh.project.conversation，会话通过官方 SessionProvider 和 conversation.content 嵌入。打开任务或团队成员对话时先挂载项目呈现，再用官方 uiWorkspace.openSession 选择真实 Session 并激活官方 conversation 主视图，使官方右侧文件预览与当前对话共享同一 Session。离开项目任务或切换普通会话时撤销临时呈现；刷新通过项目、任务及成员标识恢复，项目任务归属仍由服务检查。预览展开导致项目内容宽度不足时收起项目配置，配置浮层限制在项目区域内。侧边工作区、会话、右侧预览、模型与权限菜单仍由官方组件拥有。项目任务中提供「对话 / 流程 / 阶段团队」，选定阶段在图与团队视图双向联动。固定版本配置与实际执行观察分开；尚未创建的成员不显示为运行成功。

官方 conversation.input.left 的「工作流」入口只对授权项目会话展示已发布流程。有输入时显式启动自动模式；空输入创建待开始任务，人工发送后执行。新建任务保留项目引用，不原地替换现有会话 preset。发送中、附件或未转移的引用 chip 禁止从该入口启动，用户可在项目任务输入框选择项目资料。清理源输入使用官方 InputActions，并检查源 draftRev，避免覆盖后续编辑。PROJECT_TASK_FOCUS_EVENT 只用于界面导航，目标项目和会话必须由 Project 服务读回；URL 刷新恢复同样检查项目任务归属。

### App-Gen 工作流模板与机器门禁

Schema v4 的 Agent 节点可以声明 `gate: {kind: app-gen, step: 0..9, context: <workspace-relative-json>}`。旧版拒绝携带此字段，避免忽略门禁。完整 app-gen、YiForm、YiFlow、Magic-Script 文件作为 Skill 修订导入；每阶段固定官方 Team 的 Lead、实施和独立审查版本。

Gate 0 核对真实目标、数据源、模式和带 SHA-256 的来源证据，随后等待用户确认。运行上下文声明实际业务 appKey 及 `output/<appKey>/` 规格、状态路径。Step 1–9 在提交前重新检查前置状态，在验收时调用固定 app-gen Skill 快照的 `pipeline_state.py validate`，并要求当前及所有前置步骤为 passed；退出 0 但 0/9 不通过。控制文件超出工作区、哈希变化、Python 不可用或校验失败停止推进。通过后记录控制文件哈希；Lead 文字及本地报告存在不能代替专业证据、live 回读或运行验收。

Host 使用参数数组、无 shell、30 秒超时运行固定校验器；仅管理员进程环境可设置 `APP_GEN_PYTHON`。模板不包含业务目标 ID、凭据或自动远程写入授权。必需 YiForm、DBX、Magic-API 在本机映射后才发布运行；暂缺时保存可编辑草稿。
