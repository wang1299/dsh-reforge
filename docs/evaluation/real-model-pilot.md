# 真实模型小规模试验：复现与证据范围

[文档导航](../index.md) · [设计与预登记](../decisions/043-real-model-pilot.md) · [本轮任务](../tasks/T049-real-model-pilot.md)

## 先区分三个结果

1. [客户表单示例](../../examples/customer-form/README.md)：提供补丁的零费用显式体验，实际检查修复来源。
2. 本文自动闭环：固定真实模型生成修复，自动采集、一次提炼、独立复核与后续参考输入。离线预检使用假传输，不是模型质量结果。
3. 小规模三组对照：两个未参与本轮学习的任务，各重复两次，无记忆/普通词项检索/Reforge三组，共12次独立生成。评价后续任务，而不是用来源通过代替收益。

当前最终状态以[任务回执](../tasks/T049-real-model-pilot.md)为准；本页是复现方法，不预设已获改善。

## 零费用预检

在干净的源码提交上准备 Node 24.19.0、Python 3.10、pytest 9.1.1、Git、pnpm 11.25.0。安装与模型无关的官方宿主依赖会联网下载软件，不发起模型请求。`compat/pilot-host` 保存本轮官方0.2.1-rc.5宿主的公开依赖锁：687项，全部resolved均来自npm官方注册表，不包含Key或私人配置。

PowerShell示例（在仓库根目录）：

```powershell
npm ci --ignore-scripts
npm run build
New-Item -ItemType Directory -Path .probe-work/pilot-host -Force
Copy-Item compat/pilot-host/package.json .probe-work/pilot-host/package.json
Copy-Item compat/pilot-host/package-lock.json .probe-work/pilot-host/package-lock.json
npm ci --prefix .probe-work/pilot-host --ignore-scripts --no-audit --no-fund
New-Item -ItemType Directory -Path .probe-work/pilot-packages -Force
npm pack --pack-destination .probe-work/pilot-packages

node scripts/real-model-pilot.mjs prepare-offline --host .probe-work/pilot-host --archive .probe-work/pilot-packages/dsh-reforge-0.1.0-alpha.2.tgz --python 'C:\path\to\python.exe'
node scripts/real-model-pilot.mjs offline --run '<上一步打印的root>'
```

`prepare-offline` 不读取模型凭据；`offline` 用实际安装包、官方SDK/DeepSeekAdapter与本机合成测试服务验证协议，输出 `modelHttpRequests:0`。所有模型响应预先模拟；12次全部通过只证明评价工程跑通。此类计划明确标为 `offline-only`，不能切成付费模式。

每次创建新目录，不覆盖旧案例。输出含计划摘要和有界计数；plan、profile、SQLite和预算保留在忽略目录，不提交或上传。

## 本轮付费入口

这段只用于维护者本次明确授权的 **新增10元以内** 研究；普通插件体验请先使用上面的零费用入口。运行者需自行决定费用授权并在本机DSH保存Key，勿将Key写进命令、JSON或聊天。

```powershell
node scripts/real-model-pilot.mjs prepare --host .probe-work/pilot-host --archive .probe-work/pilot-packages/dsh-reforge-0.1.0-alpha.2.tgz --python 'C:\path\to\python.exe' --credentials 'C:\Users\your-name\.dsh\.credentials.yaml'
node scripts/real-model-pilot.mjs offline --run '<本次付费计划的root>'
node scripts/real-model-pilot.mjs live --run '<同一个root>'
node scripts/real-model-pilot.mjs status --run '<同一个root>'
```

正式prepare先核对本机托管凭据可用，不输出内容。live要求同一计划的完整离线预检通过，并在调用前用唯一固定 `.probe-work/t049-authorized-budget.sqlite` 持久化授权/开始状态和占额。全部真实请求共用这一账本；删除JSON、重复prepare、换run目录都不会授予新额度。该SQLite为财务schema2/application_id RF49，不是插件数据v9；不读取或迁移历史预算。

仅在开发修正付费前的验收工程、旧计划仍为prepared且调用为0、没有停止原因时，可显式给prepare追加 `--supersede-prepared '<旧root>'`。这在同一固定账本/10元上限内追加旧准备摘要历史并绑定新计划，保留全部旧目录；新计划须重新完整离线预检。已开始、已有任何调用或未知占额时拒绝，不能用它重放或增加预算。

计划固定实际tgz、源提交、源码与全部实际编译模块、Node宿主/插件运行文件、解释器、外部验收、模型/顺序/输出上限及摘要。检查不刷新Git暂存区缓存，固定HEAD与暂存内容；自动闭环另核对index字节。改变冻结输入时停止；不要为继续运行修改摘要或清空状态。

`status`只读本轮计划摘要和绑定账本，后续文档提交后仍可查看历史费用；它不发起模型请求，也不重新授额。live继续严格要求执行时的冻结输入一致。

只使用 `deepseek-flash`、非思考、输出请求2048、重试0；禁止服务器搜索/抓取、图片/文件操作和任意扩展。模型只能通过受限工具改一个新的合成函数，不能读其他项目或执行任意命令。整个流程不保存完整会话、凭据或任意工具原始输出。

本轮已执行结果：[2026-11-04报告、全部12项与数字回执](t049-20261104/README.md)。固定授权已completed，不能重复live；指南用于理解工程与另行授权的新研究，不授予读者费用额度。

## 怎样看结果

- `automatic-result.json`：真正的来源检查、提炼用量、后续实际输入/应用记录；模型完成提示不算验收。
- `comparison-result.json` 与 `trials/*/result.json`：固定12项的实际调用、是否提供参考、生成/测试失败、需返工及有界计数。有效代码另存为有界proposal，不存模型整段回答。
- `live-summary.json`：是否完整、三组结果、一次性学习开销、费用上界与未知占额。最后一项回执不明仍须标partial，不能因已有12行就显示完成。

预算按[官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)的峰值未命中输入2元/百万token、输出8元/百万token保守计量。调用前按完整模型边界占额5.345728元；合法完整回执到齐才按最终累计用量结算，不把起始计数重复相加。`settledUpperBoundMicroCny`是已知token费用的保守上界，`unknownReservedMicroCny`是未知调用继续保留的最大占额，均不是服务商账单。未知字段、额外费用、断流或持久化失败立即阻止后续付费请求；不通过删库、重启或新grant重试。

本试验每组仅4次，只有一条有效经验，没有失效/干扰记忆库；可能出现三组全通过、全失败或没有差异。每次只允许一次生成，没有实际返工回合；“需返工”与负路径失败是观察指标，不是节省工时或经验误用的因果证明。普通检索与Reforge使用同一来源文本，一次性学习开销另列，实际总额不重复计算；不能据此宣称已普遍提高成功率。

异常或未知结果时保留整个研究目录及固定财务账本，先核对阶段与有界回执。私密副本留在本机，公开报告仅保留合成任务、版本、摘要、计数、费用上界和明确缺失项。
