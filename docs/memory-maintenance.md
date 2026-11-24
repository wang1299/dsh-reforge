# 检查经验是否需要维护 / Memory maintenance review

从 `main` 源码运行只读检查，可核对经验来源和当前条件，查看修订或复验建议。检查本身不会执行 pytest、调用模型或修改经验授权。公开安装包 `0.1.0-alpha.2` 尚未包含维护与复验功能。

## 先体验实际控制

在源码开发环境执行：

```powershell
npm run memory:demo
```

演练只在本仓库忽略目录新建合成Git/SQLite工程，实际运行一次原始失败、修复验收与回归来建立来源，然后分别检查条件匹配、代码变化、条件文件不可读。断言三种结果及数据库字节不变，模型请求为0。来源建立执行测试，后续维护检查执行测试为0；不是三个真实Agent任务，也不是记忆收益实验。

## 检查自己的现有数据

停止使用该数据目录的DSH、面板和后台学习工作。使用包含本功能的源码构建及原配置：

```powershell
npm run build
node dist/src/cli.js memory-review --config C:\path\to\local-config.json --stopped
```

`--stopped`是所有者声明，不是进程探测。命令复用配置中的仓库和数据位置，只读打开现有SQLite v9；不创建数据目录、不迁移旧库、不读取Key、不启动worker。拒绝无库、未知schema、错误归属、运行中工作、SQLite sidecar和WAL模式。WAL数据库按既有[数据运维](maintenance.md)流程制作干净的私人副本，不自行删除日志文件。

## 如何解读

| state / reason | 含义与下一步 |
|---|---|
| `source_scope_current` | 历史来源/事实引用完整，当前代码/依赖条件匹配；新任务仍须完整检索/授权检查 |
| `needs_revalidation` / `code_condition_changed` | 条件文件字节变化；查看原条件，显式修订新candidate，再提供独立验收 |
| `needs_revalidation` / `dependencies_changed` | 依赖清单摘要变化；检查新环境，再修订和独立验证 |
| `not_qualified` / `candidate` | 仍是候选；检查来源，本报告不提升状态 |
| `not_qualified` / `disabled` | 已停用；先处理停用原因，旧来源重验不能抹除反例 |
| `not_qualified` / `invalid_source_evidence`、`incomplete_fact_sources` | 报告或引用缺失/不匹配；检查来源并走显式修订流程 |
| `unknown` / `code_condition_unavailable` | 文件缺失、不可访问或不安全，无法判定；修复环境后重查，不当作条件匹配 |

输出只包含UUID、期望revision、固定原因/建议和检查时commit，不输出经验全文、条件文件名、私人路径、配置或凭据。用UUID在原工作台查看经验；修订时核对`expectedRevision`并保留旧来源。`nextAction`是说明性建议，不是授权或可执行计划。

默认最多50条，`counts`只统计本页，`total`为该仓库当前总数；`more`为true时将`nextCursor`传入下一页：

```powershell
node dist/src/cli.js memory-review --config C:\path\to\local-config.json --stopped --limit 20 --after <previous-nextCursor>
```

每次调用重新检查，分页不是跨调用冻结快照。JSON单条读取限制1MiB；经验或验证报告主行格式错误/超限会停止检查，事实引用或其证据无效则沿用既有校验返回该条`not_qualified/incomplete_fact_sources`。两者均不会被计为匹配。数据库查询在一个只读事务内，条件文件检查只在本页复用，不是原子文件系统快照，外部变化后应重跑。

“条件匹配”不证明当前测试重跑通过、经验语义正确、适用于任意新任务或能提高成功率。本轮未实现后台维护Agent、自动归并/遗忘、自动修订/复验、默认宿主接线或真实模型收益验证。SQLite v9、历史费用/unknown占额和已用提炼次数保持。

设计：[ADR066](decisions/066-memory-maintenance-review.md)。实际检查：[T074](tasks/T074-memory-maintenance-review.md)。参考：[Anthropic文章](https://www.anthropic.com/research/components-of-agent-memory)及[官方Dreaming示例](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/CMA_dreaming_with_a_dynamic_workflow.ipynb)。本功能独立实现于有界结构化证据，不采集完整会话。

## 条件改变后如何复验

在 T075 源码工作台打开一条“来源已验证”的经验，展开 **来源、版本与管理 → 修改、停用与恢复 → 检查能否复验**。检查会读取历史报告、独立验收文件和 Git 条件。符合条件时，面板显示经验版本和将要测试的提交。点 **运行本地 pytest 复验** 才会创建新候选并执行测试。原生 DSH 页面和独立面板使用同一流程。

想先试一次，在源码目录运行 `npm run panel:demo -- --revalidation`。打开终端显示的本机入口，选择任一条合成经验。演示自建临时 Git 仓库并提交一次代码条件变化，无需 Key。保持终端打开，体验结束后按 Ctrl+C。

例如，某次修复保证“转账失败会恢复余额”。后来有人修改了记录中的代码条件，但保留相同依赖和验收用例。此时可以在新提交上重新验证。原失败需要再次出现，修复后需通过同一独立验收，原来通过的回归用例也要继续通过。通过后，新版本关联新的测试报告。可在版本历史中分别检查旧证明和新证明。

当前支持已结束的手工 Git 修复任务，需要已有的仓库执行授权、已提交的代码条件和原独立验收。依赖或验收变化、自动采集的私人快照、缺少来源的经验须单独核对。中断后先查看候选和历史记录。用户在复验期间停用了经验时，停用决定优先。历史引用仍指向当时的事实证据，绑定旧版本的用户规则需要重新核对。

验证器在运行 Python 前核对即将使用的外部验收文件字节，并比对原修复与当前提交中整个回归入口的 Git 内容。增加、删除或修改入口内的测试都需要人工检查。入口以外的应用代码和导入的辅助模块可以变化；运行时还要比对用例标识以及通过、失败状态。常规模型验证工具不能提升本次维护留下的候选；需要另行显式修订后才能按新的验收条件验证。

只读命令的 `pageProofs` 按当前页统计具有完整来源的不同报告。同一份报告被多条经验引用时，`shared` 列出对应 ID；分页间不能直接累加为独立修复数。各条建议、反馈、状态和历史继续单独保存。

在 `main` 源码目录运行以下合成案例，观察复验通过、原回归被替换、中途取消和并发修改。测试使用独立临时仓库，需按安装指南准备 Python 和 pytest。

```powershell
npm run build
node --test dist/test/memory-revalidation.test.js
```

## English

Source-only, owner-invoked `memory-review --config <file> --stopped [--limit 1..50] [--after <uuid>]` inspects an existing stopped SQLite v9 store using a read-only transaction. It never creates/migrates a store, starts workers, executes tests/models, changes experience revisions or resets grants/unknown charges. Missing stores, unsupported schema, live sidecars/WAL and active work are rejected. Reports expose IDs, expected revisions, fixed reasons/actions and the checked commit, with per-page counts and a UUID cursor. Record JSON is bounded to1MiB. Malformed/oversized experience or verification rows abort review; evidence/citation errors retain the existing per-item incomplete_fact_sources result. Neither counts as a match.

Source/scope matches are diagnostics, not semantic truth, current-test acceptance, new-task applicability or benefit. Drift recommends explicit revision to a new candidate followed by independent verification; unavailable conditions remain unknown. `npm run memory:demo` builds a real synthetic verified source, then checks matching/drift/unavailable conditions without modifying its database. No autonomous-model or future-task benefit is claimed.

T075 adds an owner preview and explicit replay in both panels for committed code-condition drift in closed manual Git repairs. It binds the selected revision, original proof and commit, preserves historical citations and appends a candidate before running independent pytest. Successful replay requires the original failing cases and the previously passing acceptance and regression coverage. An interrupted replay leaves a candidate for inspection. The page-local proof groups expose repeated use of the same report. See [ADR067](decisions/067-owner-memory-revalidation.md).
