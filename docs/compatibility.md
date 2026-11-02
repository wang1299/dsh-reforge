# DSH 兼容性

T040 / 开发候选 alpha.2：新增独立适配层与 `0.2.0-rc.2` / `0.2.1-rc.5` 目标矩阵，固定第二 SDK 图；当前目标声明不是旧公开包的新能力。实际结果、后续加版本流程及未完成的 Desktop/模型范围见 [矩阵指南](dsh-version-matrix.md) 与 [Issue #93](https://github.com/wang1299/dsh-reforge/issues/93)。以下旧阶段固定版本按历史记录理解。

目标：`@deepseek-ai/dsh@0.2.0-rc.2`。本机实际安装 Cordis4.0.5、dsh-agent/session/tools/system-prompt0.2.0-rc.2，lockfile固定依赖和完整性摘要。

T033：公开身份 dsh-reforge@0.1.0-alpha.1；固定 DSH 0.2.0-rc.2。旧本地预览的patch行ID、evolve工具、内部RPC、数据目录与配置别名保留，SQLite当前v9；迁移见[安装指南](installation.md)，实际结果见[T033验收](development/T033-acceptance.md)。下面各Txxx为历史阶段记录。

## 已验证

T027当前SQLite为v8（新增固定失败reason，旧行不变）。旧程序拒绝v8；停止旧宿主/面板、备份后再升级，禁止混跑/直接降级。原生bindDsh后台提炼需要active credentials与llm/provider；完整官方DSH包含该服务，自建宿主若缺失则等待、不占用grant。Core和独立dshExtractionPort、七工具不增加强制依赖。154项本地/8项官方兼容及实际包完整原生managed/env离线启动验证见[T027](development/T027-acceptance.md)，不能当成真实模型成功。

T026将数据库升级v7，加入owner CLI一次显式重新授权，七个DSH工具及模型适配接口不变。v6原行、旧unknown和已用grant保留。旧程序拒绝v7；先停止所有旧宿主/面板并备份后安装，不混跑或直接降级。新调用需要独立授权的新单次grant，不重置财务预算；详见[ADR028](decisions/028-explicit-extraction-reauthorization.md)。源码验收不代表既有运行环境自动升级或真实响应已通过。

T025引入SQLite v6与owner CLI显式证据恢复，七个DSH模型工具不变。迁移保留旧JSON/Job/Bundle/grant用量，旧程序拒绝v6。升级需停止所有旧宿主和面板、备份数据库，再安装实际验收包；禁止混跑或直接降级。诊断摘要截断不等于缺少必需来源，仍须独立可执行验证。当前实现验证与安装状态见[T025](tasks/T025-observation-recovery.md)；下文T020–T023的v5记录为历史范围，不代表新包已安装或真实恢复成功。

T023在新的完整Windows官方0.2.0-rc.2 profile实际安装6742214产品包（24 JS匹配、七工具），全部宿主服务来自完整host。真正AgentLoop/固定进程内Adapter跑begin/纠正/修复提交/finish→后台pytest/自动candidate→下一正常provider输入中的数量提醒→实际list回执；7次Agent+1次提炼、模型HTTP0、candidate不激活。同库安装包CLI面板和撤销临时授权后的正常Web重启通过；实际失败和公开重建限制见[T023验收](development/T023-native-discovery.md)。这不是实际模型或未来收益证据。

T022在原六工具上增量加入`evolve_list_candidates(taskId?)`，SQLite仍v5、既有工具输入不变。固定官方AssembleContext.agent/systemPrompt.context用于同session数量提醒；diagnostic assembly无Agent时不含数据。兼容探针增加共享关闭、session/cwd隔离和卸载边界，当前包为七工具；历史六工具验证记录保留。实际安装/浏览器/CI与评审结果见[T022任务](tasks/T022-candidate-discovery.md)及关联PR，不能以旧T021试装替代新包验证。

T021新增实际tgz自动候选链路与三条负路径，逐文件检查24个产品JS并核对Loader模块身份；官方AgentLoop为真实组件，模型是固定脚本。另在全新Windows完整0.2.0-rc.2 profile实际安装、加载和重启，原profile不改。组件演练与完整应用加载证据分别记录，不构成真实模型完整学习；见[T021验收](development/T021-acceptance.md)。

T020增加精确可选peer `@deepseek-ai/dsh-llm@0.2.0-rc.2`（运行代码只经宿主服务，不导入provider/Key）。compat使用真实LlmRuntime.prepareCall与一次性stream，合成Adapter覆盖精确路由/maxTokens、无伪造session/purpose、文本/usage、坏流、晚注册provider和卸载中断。默认六工具仍可在无LLM服务下运行。源码兼容与本轮实际包/CI记录见[T020任务](tasks/T020-auto-extraction.md)，不等于真实模型提炼质量。

`npm run compat` 使用发行包真实Context、SessionStore、ToolRuntime、SystemPrompt，注册六个工具和提示区，执行开始/完成任务、记录纠正、提候选和关联事实来源、拒绝陈旧/跨session操作及未授权验证、采集最小工具结果元数据，并验证卸载移除工具和提示区。

Agent仅传入身份fixture，没有运行LLM主循环；不可将此探针描述为真实模型端到端成功。

`npm run install-probe -- <local.tgz>`：实际调用官方plugin-manager共享安装操作，装到新的隔离profile，用app-boot读取/组合bundle并经真实Loader加载安装包，检查六个工具和提示区，执行合成开始任务。peer服务由源码工作区提供，不等于完整DSH发行应用的安装；无模型调用。它已发现并修复原manifest没有insert导致组合为空的问题。

2026-10-19另行完成Windows完整官方DSH CLI/Web试装：独立host安装0.2.0-rc.2、官方CLI创建web模板profile并安装当前tgz；服务解析均来自完整host，实际Web插件详情显示一个组件运行中，停止/重启后仍加载。执行信任/模型共享关闭，没有模型调用。匿名HTTP401是访问保护，浏览器已通过本机令牌进入。见[实际步骤、peer诊断及限制](development/T006d-installation.md)。

## 未验证

- 正常DSH完整自主学习、候选提取质量和经验收益。T011官方SDK真实Agent已观察begin/纠正及有效源码提案，但候选失败、复用未开始，详见[T011](development/T011-acceptance.md)。
- Desktop发行应用安装器、其他平台完整CLI/Web安装及跨版本兼容；Windows固定CLI/Web的已验证范围如上。
- T010本地53项及六工具兼容通过，当前头两平台CI/实际tgz及独立评审见关联PR与[T010验收](development/T010-acceptance.md)。T006d完整Web为历史安装包，不自动扩展到本轮新代码；组件CI不等于真实DSH模型回合。

## 数据与工具兼容（T010）

当前T020为SQLite user_version=5：v2/v3/v4旧JSON/历史不改，增加Job/Attempt/证据包及来源保留引用；v1仍沿用原报告降级流程。旧SQLite4及更早程序会拒绝v5，禁止混跑/直接降级；不自动重建历史已关闭任务。六工具、Task/Experience/Verification格式保持；新增配置backgroundVerification默认false且执行仍需executionTrusted。DSH固定官方类型的session/event与tools/result接口保持，finish自动入队和后台生命周期由兼容探针验证。详见[ADR022](decisions/022-task-evidence-jobs.md)及[T019验收](development/T019-acceptance.md)。以下保留T010迁移语义。

SQLite user_version=3，事务创建最小evidence与fact_citations，保留v2全部旧JSON/历史/报告；v1继续原有报告身份降级再迁移。旧库缺逐条引用时默认evidence-v1拒绝自动复用；v2不改写source_verified修复状态，v1沿用降级重验迁移。旧SQLite2程序会拒绝v3，不支持混跑或直接降级；本机既有完整DSH预览安装未自动更新，禁止把用户库拿来做破坏性测试。

Task/Experience v1、Verification v2和历史评价格式不变。新增evolve_link_fact_evidence及现有工具的来源/事实摘要receipt是增量接口。Candidate自身模式不变，propose工具另有可选citations。冻结Codex脚本固定原策略；本轮没有新模型调用，不宣称evidence-v1收益。引用只证明出处一致，不认证文字真值。详见[ADR013](decisions/013-fact-evidence.md)。

## 模型输入契约（T012）

固定DSH原生schema现在显式公开Candidate字段和FactCitation四字段，嵌套对象封闭、revision为integer。推荐先propose不带引用，再复制实际facts/同任务receipt并使用最新revision执行link；receipt.kind不属于引用，不能猜摘要。原Zod/服务层继续校验全部数量/路径/摘要/权限限制。离线错误重放与实际组装探针见[T012](development/T012-acceptance.md)；没有新模型验证或新数据迁移，T011失败保留。

## 本地接入（开发预览）

### 离线原生AgentLoop演练（T014）

`npm run dsh-rehearsal`通过固定0.2.0-rc.2真实AgentLoop连续执行六工具与来源/新任务验证；模型由唯一进程内固定脚本替代，未运行DeepSeek/SDK HTTP，也不证明模型理解经验。此前compat身份fixture探针继续保留；演练与错误引用/失败测试/关闭共享负路径见[T014验收](development/T014-acceptance.md)。新增包仅开发依赖，不能将本演练算作完整发行应用或真实模型端到端成功。

构建安装包后，通过固定DSH版本将本地tgz装到独立测试profile；本机Windows完整CLI/Web试装已通过，日常模型学习仍待验收。当前包未发布到npm。

源码工作区的可复现安装组件探针（另需pnpm）：

```sh
npm run build
# 先创建本地 .probe-work 目录，然后打包
npm pack --pack-destination .probe-work
npm run install-probe -- .probe-work/dsh-reforge-0.1.0-alpha.1.tgz
```

报告和测试profile保存在`.probe-work/install-probe-*`，不会修改已有用户profile。Codex受限提案/宿主写入与外部pytest已另行实现；强安全隔离、正常DSH完整学习及真实任务收益仍待验证；T011有引导的真实SDK回合为partial。

插件读取可选环境变量 `DSH_REFORGE_CONFIG`（旧变量兼容见安装指南） 指向本地JSON配置，或由Cordis传入Config。未配置时以进程cwd为单仓库，关闭执行信任和模型共享。

```json
{
  "repoRoot": "/absolute/path/to/target-repository",
  "dataDir": "/private/local/path/evolve-data",
  "executionTrusted": false,
  "backgroundVerification": false,
  "shareWithModel": false,
  "acceptanceDir": "/independent/path/acceptance",
  "python": "python",
  "regressionPath": "tests",
  "timeoutMs": 15000
}
```

用户明确接受执行目标仓库代码后，才将executionTrusted设为true。用户明确接受把经验传给当前DSH模型后，才启用shareWithModel。验收目录必须在目标仓库之外。默认数据在用户目录`.dsh/evolve/<repository-hash>/evolve.sqlite`，不写目标仓库。

T019结束任务后默认只整理已有来源；若owner希望后台自动验证无候选的修复，还须显式开启backgroundVerification。DSH插件或CLI面板运行时处理/恢复Job；核心调用方可显式jobs.runNext()。已开始验证后中断的unknown不会自动重跑；源码checkout并不自动更新既有Web预览安装。
