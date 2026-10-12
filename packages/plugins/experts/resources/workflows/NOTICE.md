# 工作流来源与适配

来源：https://github.com/fufankeji/deepseek-harness-studio/tree/257d429156a243517a2cafdff777125cd3fb6d54/apps/desktop/resources/preset-square

完整引入七套工作流、九个 Skill、参考资料、模板、脚本及原始配置，共 98 个来源文件。保留 MIT 和资源附带许可证，不引入 Studio Host、Client 或 Electron。七套来源目录的全部 98 个文件（含预设、九个 Skill、模板与原生成脚本）保持上游原文，按 source-manifest.json 逐文件校验。WorkDSH 运行适配仅位于 adapters/，通过明确的运行入口映射装配，不覆盖原文件。

七套配置逐项保留原有工具、参数、顺序、禁用标记及隔离分组，不套用通用工具清单。针对锁定的官方 DSH 0.2.0-rc.2，仅将 persona.text 映射到 prefix、旧 workflow-worker-thread 映射到当前 workflow-ptc，解析明确列出的平台与包内路径表达式，重定位包内工具路径。原 YAML 不执行任意 JavaScript。

文件搜索和 PowerShell 使用独立的工具适配入口，内部仍委托锁定的官方工具实现。广泛 glob 查找默认跳过 node_modules、.artifacts、.pnpm-store、.yarn/cache 和 official-release-cache，避免扫描依赖、安装包及运行证据；明确指定这些目录的 path 或 pattern 时保留完整原始搜索。项目源文件、隐藏上下文、Skill 及 Yarn 补丁不被排除，grep 保持原始范围。参数、排序、输出、完整结果保存和超时契约不变，默认排除范围向模型明确说明。

Windows PowerShell 工具先执行固定的只读启动探测，仅当当前引擎出现明确 CET 启动错误且系统 Windows PowerShell 探测成功时，才为这七套工作流改用系统引擎。仍经过已挂载执行器的沙箱、审批、工作目录和进程生命周期；不修改全局 Shell 设置或 Windows 安全设置，不重试用户命令。模型会获知实际 PowerShell 5.1 版本，用户随后调整 Shell 路径时仍使用新的配置。

飞书使用官方凭据服务、MCP SDK 与 DSH 工具桥接，保留两个原始服务、工具名称、参数及各自的调用超时；密钥仅传入子进程环境。工具生命周期与 Windows/Electron Node 环境由 WorkDSH 适配。

PPT Office 的原版交付是 8 页、四主题、离线交互式 HTML，而非 PPTX。上游生成脚本存在场景类名与模板不一致、导航部分替换及第六页交互丢失的问题。adapters/motion-deck/generate-deck.mjs 根据原模板的场景、交互和导航契约修复生成流程，保留原模板与八种动画，增加长文本容器适配、结构验收和入场定位适配。原版晴空主题会使偶数纵向卡片及流程卡片下移 18px；根据用户明确提出的避免重叠和五张流程卡片处于同一水平线要求，仅对这两类卡片取消位移。该展示适配不等于上游原版视觉逐像素相同；上游原文件仍保持原文。
