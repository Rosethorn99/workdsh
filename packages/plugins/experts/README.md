# WorkDSH 专家插件 / Experts plugin

一个插件管理多个专家与专家团配置。当前源码候选为 `workdsh-plugin-experts@0.1.0-alpha.14`，精确锁定 **DeepSeek Harness 0.2.0-rc.2 / Cordis 4.0.4**；实际构建、安装与运行范围见[验收要求](../../../apps/web/docs/ACCEPTANCE.md)，旧探针和已发布安装包不能证明本轮候选已验收。

WorkDSH manages authored expert assets and immutable revisions. Team execution, messaging, tasks and the Web team panel use the official DSH Agent Teams plugins.

## 专家资产与官方团队执行

- 专家目录、搜索、收藏、复制、草稿、导入导出、启停和确认发布由专家插件管理。页面与 Agent 管理工具使用同一 Host 服务。
- 专家和专家团的卡片菜单提供“分组和标签”：每项一个分组、最多 20 个标签，可选择已有分组或输入新分组，留空移出分组。列表可组合搜索、分组与标签筛选。整理信息保存在当前主体的个人偏好中，未整理时显示原内容标签与分类；整理、置顶和最近使用互相保留，已发布内容及历史任务绑定保持原样。
- 支持 WorkBuddy 风格作品：`plugin.json`、`agents/*.md`、`settings.json`、README，以及 `skills`、`references`、`scripts`、`templates` 和二进制资源。
- 发布冻结专家定义、成员修订、技能快照和官方 Agent preset。召唤创建原生任务并关联该版本；修改草稿不会静默改变已经发布的内容。
- 团队创建成员使用官方 `spawn_teammate`；消息、等待、中断和共享任务也使用官方工具。团队面板直接加载官方 Client，不再另做一套成员状态面板。
- 已发布成员的 key 对应官方 teammate 的 name。在公开 `agent/created` / `agent/pre-step` 中核验资产、主体和组织，通过 Agent 局部的官方 Persona / Skill Filesystem 插件装配该成员。未配置的成员名在模型请求前拒绝。
- 场景与分工保留为工作指导；任务依赖和状态由官方 Team 及 Session 日志拥有。任务标记完成不等于专业成果已经验收。

## 官方装配

本包的 `cordis.patch.yml` 装配三个精确锁定的官方插件：

| 插件 | 职责 |
| --- | --- |
| `@deepseek-ai/dsh-experimental-agent-team` | 成员、消息、共享任务、持久化恢复 |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | 官方九项团队工具 |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | 官方成员与共享任务面板 |

启用 Team 时，按官方 Profile 组合停用旧 `subagent`、`subagent_fork` 及旧控制工具。默认成员创建上限为 16。九项工具为 `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`。

WorkDSH 的必需组合仍包含 identity-local、audit、access、skills、experts；可选 bundle 提供工作台导航，activity 仅显示个人工作动态。各包通过官方 Loader/Profile 和公开服务注入装配；无自建 Agent loop、消息邮箱、团队执行表或插件加载器。

## 旧版迁移边界

已删除自建 `TeamRunsManager`、SOP 运行状态机、`workdsh_expert_team_*` 工具及 `workdsh-expert` 委派 provider。构建前清理 `dist`，防止旧执行器残留在新安装包里。

用户的专家、技能、发布修订、文件和旧任务历史保留。旧版委派子任务不再续跑旧调度器，应从专家团重新召唤官方 Team 任务。旧团队运行表不会转写成伪造的官方执行记录。团队配置仍可复用，不要求重建用户作品。

原 WorkBuddy 规范与许可证归属保留在资源目录；平台适配说明维护在 `resources/skills/workdsh-expert-manager/references/authoring-api.md`，团队运行指引维护在 `runtime/team-lead.md`。

## 构建与验证

在仓库根目录使用 Node 22 和固定的 pnpm：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test:integration
corepack pnpm test:activity
corepack pnpm probe:experts:team
corepack pnpm probe:experts:team:web
corepack pnpm probe:experts:team:resilience
corepack pnpm probe:experts:team:real
```

- `probe:experts:team` 使用真实 Loader、生产资产服务与执行准入、官方 Agent Loop/Team/持久化；仅模型 I/O 和受信本地入口使用夹具。验证并行、各成员角色与技能、fresh/fork、非法成员和跨主体拒绝、任务依赖/CAS、模型工具分派、中断及独立进程恢复。
- `probe:experts:team:web` 将七个功能包打成 tgz，通过官方 CLI 安装到仓库外临时 Web Profile；使用实际生产 Host、官方 Team Client、真实浏览器和确定性模型检查成员、任务写入、成员会话与冷恢复。
- `probe:experts:team:resilience` 是同一生产安装探针的发布验收入口，并固定持续运行、人工停止后原成员继续、完整浏览器重连、成员间任务与消息交接、失败状态展示及冷重启恢复。失败由本地模型适配器确定性注入；成员、消息、任务、持久化、Host、Client 和浏览器均走正式实现。
- `probe:experts:team:real` 显式读取已配置的 preview DeepSeek 凭据，在一次性 DSH Home 中创建独立真实执行；真实 lead 创建两阶段任务并通过官方消息与状态工具交给两名真实成员。凭据不进入命令参数和报告，临时副本在退出时删除。
- `probe:experts` 保留专家资产与编辑页面的独立打包回归。

此前 `.artifacts/dsh-0.1.6-upgrade/native-expert-team/` 和 `native-team-web/` 结果属于旧候选历史，不作为当前 0.2.0-rc.2 源码验收。当前实际结果以[验收要求](../../../apps/web/docs/ACCEPTANCE.md)为准。探针使用独立 Home；只有显式 `:real` 命令调用付费模型。

官方 Team 仍为实验性能力。旧候选纯官方 fork 历史查询曾记录 `seeded session constructor seed must equal its inherited prefix` 问题；公共持久化读取与成员冷恢复的通过不能代替 Web 分叉历史验收。默认使用 fresh 成员。真实模型专业成果质量、企业远程多用户和完整热卸载仍须分别验收，不宣称本轮已完成。

## 安装候选包

当前源码依赖 DSH 0.2.0-rc.2 / Cordis 4.0.4，应使用同一次构建产出的配套 tgz；不要把旧 Release 的安装包当作已含本次升级。先在独立 Profile 验证，再部署实际使用的 Profile：

```sh
dsh --profile workdsh --from-default-profile web --dump-config
dsh plugin --profile workdsh add /absolute/path/release/workdsh-provider-identity-local-0.1.0-alpha.6.tgz \
  /absolute/path/release/workdsh-plugin-audit-0.1.0-alpha.5.tgz \
  /absolute/path/release/workdsh-plugin-access-0.1.0-alpha.6.tgz \
  /absolute/path/release/workdsh-plugin-skills-0.1.0-alpha.32.tgz \
  /absolute/path/release/workdsh-plugin-experts-0.1.0-alpha.8.tgz
dsh --profile workdsh
```

在专家入口保存、校验、预览并确认发布，然后召唤。示例只填入原生草稿，发送后才执行；模型与账号在 Harness 中配置。

页面与弹窗使用 Harness 原生主题语义颜色，跟随官方外观设置及系统明暗切换。

可信 Host 可以通过 `ExpertsManagerOptions.agentsHome`（也适用于 `applyExpertsHost(ctx, options)`）指定独立目录；导入、预设编译、包检查与执行 guard 使用同一目录。不传配置保持个人 env/home 默认值。当前企业使用独立账号进程内的同一专家包、官方 Skill filesystem 与 Agent preset；旧共享 Host 的管理/执行 selector 已删除。目录配置不代替会话归属、文件与执行授权。实际企业装配范围见[验收要求](../../../apps/web/docs/ACCEPTANCE.md)。

### 专家技能扫描配置

`ExpertsManagerOptions.includeDefaultSkillRoots` 为可选启动配置。省略或 true 保留个人版默认项目/用户技能发现；false 生成仅使用受管 Skill 快照及专家包资源的官方 filesystem provider 配置。false 参与不可变 preset 标识及输入摘要，不能复用旧的默认扫描 preset。此配置由服务器装配传入，不从浏览器请求接收。独立目录不等于完整企业执行验收；官方 preset/子 Agent 仍需成员组合验证。

## Studio 七套工作流

本插件内置 AI WebApp、PPT Office、视频生成、内容工厂、AI 报表、飞书数字员工、LLM Wiki Producer。它们通过官方 PresetRegistry 注册，不复制到用户技能目录，也不改变默认 standard 模式；随插件卸载撤销注册，运行中的会话遵守官方 revision 租约。左侧“工作流”与独立 main 页面配对，原生会话仍由 SessionAccess 创建。

资源、脚本、原配置和许可证位于 resources/workflows，来源提交与目录由 catalog.json 记录，适配范围见 NOTICE.md。逐项保留原配置的工具、参数、分组隔离与禁用状态；仅适配官方发布版本更名的接口、平台路径及凭据桥接，不套用通用 standard 工具清单。98 个来源文件全部保持上游原文并记录 SHA-256；三个运行适配独立放在 adapters/，入口映射记录于 source-manifest.json。九个 Skill 正文与原始预设、脚本及模板都不做原地修改。内置工作流作为包资源更新；现有用户专家、技能与项目不迁移、不覆盖。

飞书凭据使用官方 CredentialsProvider，每次 MCP 操作重新解析并仅传给本机子进程；配置 API 只返回保存状态，目录只返回配置是否齐全。MCP 协议由官方 SDK 及 DSH createMcpToolDefinition 处理。企业模式只在员工 Desktop 运行；该工作流不是企业登录或成员授权。PPT 原版交付为 8 页、四主题、离线交互 HTML，独立运行适配修复原生成流程的场景类名、交互与导航问题，用户要求的流程卡片水平对齐作为明确的展示适配记录；图像桥依赖 Codex CLI，视频依赖 FFmpeg/ffprobe/HyperFrames，Wiki 是分阶段研发指南。

共享源码构建与插件归档不代表七套工作流已完成真实模型、付费图像、飞书写入或 Desktop 安装验收。当前验收应分别检查 Preset/Skill/工具组合、隔离安装、页面、新会话和具体外部交付。

### 工作流制作与文件编辑

列表顶部的“新建工作流”创建个人草稿；名称必填，用途说明选填。“AI 任务 + 人工确认”提供已连接的开始、任务、审核和结束；“空白画布”只提供开始入口，允许自由添加和连线，完整校验前不能运行或发布。创建后直接进入 AI 流程编排，可绑定 Skills、已发布专家 / Agent Teams 与连接器；搜索和最近更新排序便于回到自己的流程。取消不创建，创建按钮防止重复提交，网络重试复用 operationId。用户流程使用独立中性 Preset，不复制七套内置工作流的角色或技能；绑定能力按现有固定修订服务解析。其完整文件包支持导出、导入和复制，来源标为用户创建。

在“工作流”查看内置包，点击“复制并编辑”创建个人草稿。可视化属性与文件编辑使用同一份文件内容；完整 Preset、Skills、references、模板、脚本和二进制资源保留在包内。可编辑角色提示、插件顺序和启用状态、参数以及名称说明；平台表达式和未映射字段在文件视图编辑。保存冲突会保留本地修改并提供比较与合并。

“保存草稿”不发布、不运行脚本。“校验”检查格式、技能和已安装插件引用；“运行”冻结独立快照；AI 编排模式输入一次需求后自动推进，在人工确认节点等待审核；原版兼容模式仍进入原生对话。“发布版本”冻结完整文件、编译声明及适配器；新会话绑定明确版本，旧会话保持启动时的 Preset。版本界面支持查看完整旧文件、使用指定版本以及回滚默认版本。导出 `.workdsh-workflow.json` 包、导入预览和确认导入均保留完整文件；导入只创建草稿。

Host 在 agentsHome 下的 `.workdsh-state/workflows` 保存个人工作流，通过官方 Connection 的 `workflow-authoring` 操作提供列表、详情、复制、文件补丁、校验、试运行、发布、设默认版本、原生会话创建和导入导出。每次请求使用可信身份与 AccessService，变更写入 AuditService；不从浏览器接受所有者身份或凭据内容。发布文件哈希在恢复和新会话创建时复核，路径和 Windows 大小写冲突检查覆盖所有文件。

项目指令使用明确的 `本项目仅使用现有工作流“名称”（workflowId=wf-…）` 约束时，项目启动入口与对话中的工作流入口都固定使用该流程，Host 创建运行时复核项目当前配置。未发布的固定工作流仍展示名称和不能运行的原因；不存在、已归档或无权访问时不能改用其他流程。普通文本中的工作流参考不形成绑定。对话中的入口创建新的项目工作流任务；运行与发布仍遵守原有能力和版本门禁。

默认采用原版兼容模式，保留全部 Preset 与 Skill。PPT 与内容工厂副本包含独立、可编辑的实际运行适配脚本；原始模块完整留存，运行入口由 workflow.yaml 的 runtimeOverrides 明确指定。模板、实际运行脚本、技能修改会进入发布快照。

“AI 编排”提供自由节点画布：节点库拖放、左右端口拉线、曲线连接、条件分支、多终点、Shift 多选、整组拖动/复制、Delete 删除、撤销/重做、缩放、小地图和全屏。选中节点才展开右侧参数、能力和输入输出。草稿允许断线和独立节点，删除不会裁掉未选中的分支；运行与发布再检查完整可达、无环和真实产出。逻辑保存到 workflow.yaml，布局保存到 layout.json。

点击“运行”输入需求，Host 为每个 AI 节点创建固定版本的官方会话，通过 Session Controller prompt 自动提交；回合成功且真实非空新文件通过 SHA-256 检查后推进。人工确认等待你审核，失败或必需能力缺失停止推进。暂停取消当前回合并阻止后续提交；历史手动运行不自动启动。提交意图先持久化，重启复用稳定 requestId，官方接口防止重复接收。退回历史任务修复切换为手动检查，避免自动重放外部业务。企业业务审批与真实专业成果仍需单独验收。

当前支持最多 32 个实际节点、文件存在分支，以及 v5 文本和文件内容条件；循环、任意条件表达式及并行分支调度尚未提供。专家团内部并发由官方 Team 执行。

在节点“能力”中选择工作流原版角色、已发布专家或专家团，并增加已安装 Skills、选择阶段连接器。能力引用采用 Schema v2；发布时锁定专家/成员 revision 与技能哈希，连接器保存逻辑需求，在本机映射并实际应用到阶段会话。显式空连接器列表表示本阶段不选连接器；继承与独立配置分开。必需连接器未就绪时显示等待能力并阻止模型启动。人工确认、文件条件和本地文件检查保留各自语义，绑定专家不会自动批准或额外调用模型。

发布和运行先校验当前草稿；失败时展示真实插件与 Skill 数量，并暂停这两个入口，修复后可重新校验。验证页汇总所有必需连接器的缺失映射和受影响阶段，可从已安装 MCP 中显式选择对应服务并应用到整个工作流，同时更新默认配置、阶段及团队成员引用，保留必需约束。单个阶段也提供映射选择。映射只修改草稿；保存、校验和发布不会授予当前会话工具或执行业务操作。

验证页选中连接器后显示“连接器映射待保存”；点击“校验”会先保存所选映射，再校验新修订。也可直接点击“保存映射并校验”，避免下拉框已经选好却仍检查旧占位引用。保存冲突或失败保留本地修改；离开或放弃沿用未保存修改的保护。

发布在本次请求内重新检查全部阶段能力，并复用这些检查结果冻结锁文件和编译各阶段 Preset；同一个 Skill 修订只保留一次。不会重复解析三轮完整专家团，也不复用之前页面校验的结果；下一次发布和运行仍重新核验来源状态与文件完整性。

自动保存采用 1.5 秒防抖与版本比较；冲突或失败时保留本地修改并暂停自动保存。文件修改与图形配置同步，验证问题可定位到阶段。运行页读取本次固定版本的运行图，节点可查看会话、声明产出和真实验收记录；没有执行证据时显示待开始。模型高级覆盖只引用官方已配置的 provider/model，不保存密钥。

### Langflow 编辑体验

现有工作流入口提供常驻分类组件库、搜索和拖放、节点内参数、注释、对齐辅助线及连线预览；任务可绑定平台已有专家、团队、Skills 和连接器。复用源码固定在 Langflow v1.12.5，完整来源、哈希与 MIT 许可见 resources/langflow。对齐和缩放使用可独立复用的原版代码；节点卡片与注释按原版布局适配 WorkDSH 数据。这里交付原生编辑器适配；完整 Langflow Python 组件、Playground 与 RAG 运行时需另行安装插件。

workflow.yaml v5 支持 If-else 文本与文件内容条件，提供等于、不等于、包含、开头、结尾、大于和小于比较。文件输入仅可读取授权工作区内至多 1 MiB 的 UTF-8 文本，拒绝路径穿越与链接，判断回执保存实际文件 SHA-256；旧文件存在分支保留。读取和写入文件节点使用官方 Agent 任务与真实产出检查。注释仅存于 layout.json，不生成任务或调用模型。节点属性、YAML、布局、批量操作与撤销继续使用同一份草稿。
