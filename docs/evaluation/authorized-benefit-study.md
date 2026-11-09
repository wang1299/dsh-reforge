# 真实对照入口：先审计划，再单次授权

[English below](#english) · [ADR059](../decisions/059-frozen-authorized-live-study.md) · [任务检查记录](../tasks/T065-frozen-authorized-live-study.md) · [冻结题目](benefit-preparation-v1.md) · [费用策略](study-cost-guard.md)

这是未发行源码的研究入口，独立于正常 DSH 对话和插件学习授权。它把同一官方 SDK、修复控制器、独立测试和研究账本连接起来。**准备和模拟通过不代表真实模型有效，也不产生付费许可。** 公开 alpha.2 不包含这些源码工具；当前实际检查与待办见任务记录。

| 阶段 | 做什么 | 会产生模型费用吗 |
|---|---|---|
| prepare | 固定来源库、36项顺序、23项验收控制、候选包及实际运行文件；默认未授权账本 | 不会；只下载固定 Python wheels 和公开价格文档 |
| inspect | 只读显示计划摘要及账本，不恢复、不重放 | 不会 |
| qualify | 在全新模拟 authority 中走相同 live 分支、官方 SDK、费用保护和受限测试；只注入 fake fetch | 不会；模拟用量与金额不可当真实节省 |
| authorize | 所有者核对摘要后，给这一个计划明确上限和付费确认；固定审批文件只建一次 | 此命令不调用模型 |
| live | 核对原授权和全部文件，之后才读取本次专用 Key；最多两轮/题 | 会；必须先获得新的明确许可 |

## 零费用复查

使用干净、已提交的本仓库源码，Node24.19.0、Git、Python3.10，以及固定 npm lock。先完成正常代码检查，再运行完整资格模拟；不要一边模拟一边重编译或改源码。

```powershell
npm ci --ignore-scripts
npm run check
npm run compat
npm run study:qualify
```

`check`已编译执行文件，`qualify`不再次构建。模拟固定36项：首项直接通过，一项两轮均已知失败，其余先失败后通过；预期71次模拟 provider 请求。已知失败必须保留并继续，不能为了演示全部通过而换题。完整运行与最终测试数量以任务记录为准。

每次创建新的`.probe-work/t065-live-path-fixture/run-*`，包含计划、模拟审批、账本、结构化测试结果和`qualification.json`。来源库只包含本仓库的合成案例，未加载用户数据库或旧profile。原始对话/HTTP正文不持久化；生成的有界函数和固定验收留在本机忽略目录。

## 准备可审查的真实计划

```powershell
npm run study:prepare
npm run study:inspect -- --plan run-本次目录名
```

prepare不读取Key，创建固定`.probe-work/t065-benefit-live/preparations/run-*`下的独立未授权账本。摘要列出源码提交、计划SHA256、24小时有效期、候选包SHA256、实际文件数量、3份来源证明、Python版本和23项控制。保持该工作区和执行环境不变；重建、源码/依赖/解释器变动、价格页变动或超期都需要重新准备。旧计划不删除。

价格绑定人工核对的[官方flash峰值文档](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)原文摘要；同模型标签仍在但页面费率变化，也不能接受新计划。现策略按输入2/输出8元/百万保守结算，单次预留5.345728元、建议总上限10元、最多72请求。预留不是预计每次花费，token上界不是服务商账户硬限制；未知回执保留整笔，余量不足下一笔完整预留就停止。**T049旧10元许可不能复用。**

确认方案和新预算以后，才由本次明确授权执行：

```powershell
npm run study:authorize -- --plan run-本次目录名 --digest 完整64位摘要 --cap-cny 10 --acknowledge-paid-calls
```

cap不得高于实际批准金额。审批绑定唯一计划和账本，不能改上限、改目录或另批一笔。相同未开始审批可补完中断；已经开始的账本重开标未知，不继续。inspect不把started改回prepared，也不清锁/未知占额。

## Key只在本机输入

下面是获得新预算且审批成功之后的**本机**步骤，不向聊天发送Key或完整配置。直接启动Node，避免把Key交给额外npm/命令包装进程。

```powershell
$studySecret = Read-Host '本次研究 DeepSeek Key' -AsSecureString
$env:DSH_REFORGE_STUDY_KEY = [System.Net.NetworkCredential]::new('', $studySecret).Password
try {
  node dist/scripts/study-live-runner.js live --plan run-本次目录名 --digest 完整64位摘要
} finally {
  Remove-Item Env:\DSH_REFORGE_STUDY_KEY -ErrorAction SilentlyContinue
  $studySecret.Dispose()
}
```

专用Key只在授权/冻结核对后从当前Node环境读取并移除，保存在固定provider backend内存；官方SDK只持有本机临时凭证。研究Git与Python子进程环境均为白名单，不继承Key。模型代码验收必须先安装实际Windows Job或Linux资源上限，禁自动pytest插件/conftest，用新vendor与`-I -S -B`，失败不回落旧执行器。这是有界合成函数的资源保护和AST准入，不是任意代码的完整OS沙箱。

## 怎样读结果

`study-result.json`分别保留每组计划12项、已尝试、记录、未尝试、未知、首次/最终通过、已知失败、无效输出、返工、引用、token、保守费用、未知占额及耗时；按题和重复保留三组配对。单次源码证明、提供了经验或模型说成功，都不能替代固定pytest验收。

完整36项表示协议执行完毕，不表示36项都通过。模拟模式始终标记`simulatedAmountsOnly`，不能用于简历的模型提升数字。真实执行后也只有6项作者可见合成任务、各两次重复；须报告负结果、不确定性和覆盖损失，不能声称外部用户、盲测或普遍效果。guard与provider耗时分开，模型别名不证明底层权重固定。旧产品数据、预算、未知费用和提炼次数不重置。

## English

This unpublished source entry point separates preparation, read-only inspection, one-plan authorization and paid execution. `npm run study:qualify` uses the actual live branch, official SDK, durable accounting, frozen runtime and bounded Python worker with a mandatory fake provider. Its fixed36-trial control includes an immediate pass and a persistent known failure; expected71 synthetic requests are protocol evidence, never model improvement.

`study:prepare` creates a new unapproved plan under the fixed authority. It binds source and actual executable/dependency bytes, a reviewed official price-document hash, a private synthetic source snapshot and a24-hour expiry. Rebuilding or changing inputs invalidates the plan. Inspection does not recover or replay work. Explicit authorization requires the exact64-character plan digest, a newly approved cap and paid-call acknowledgement; it can bind only one ledger and cannot renew a started study. Historical grants are not reused.

After all checks and fresh authorization, enter the dedicated Key locally and invoke Node directly. Git/Python receive allowlisted environments; the SDK receives only a loopback token. Real fetch uses one fixed endpoint with no retry. Unknown usage retains its entire reservation and stops the batch. OS resource limits plus AST admission protect this bounded synthetic workload; they are not a general OS sandbox.

Report planned, attempted, missing, unknown and failed trials along with first/final acceptance, rework, references, usage, conservative costs and paired outcomes. A completed protocol is not an all-pass result. These six author-visible tasks repeated twice cannot establish blind or real-user generalization; source verification and reference delivery remain separate from downstream benefit.
