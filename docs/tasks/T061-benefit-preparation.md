# T061：下一轮真实收益研究的题目与送达预检

2026-11-06 / [Issue #135](https://github.com/wang1299/dsh-reforge/issues/135)，基于T060冻结源码`d5a98ae545770cf1e2b54bc2f934ea0716d03eec`的独立分支`codex/t061-benefit-study-preparation`。不修改PR #134，不合并或部署；完整持续目标仍包括真实模型效果和用户体验。

前面的日期与下文原回执保留2026-11-06准备快照；2026-11-09的主分支、合并和测试变化见末节，不把“当时未合并”当当前状态。

## 事前材料

- 设计先于实现：`751868f` [ADR055](../decisions/055-new-task-benefit-study-preparation.md)。
- 题目/策略/参考与错误控制/36项计划先于runner：`be525db` [fixture](../../scripts/benefit-study-cases.ts)。
- 结果解释及复现：[新任务准备报告](../evaluation/benefit-preparation-v1.md)。

## 已观察与待验

首轮针对测试4/4通过，发现并修正新来源库克隆时丢失候选→已验证版本历史的实现错误，保留真实revision2，不伪装revision1。独立审查进一步发现外部验收盲点，原v1完整归档；v1.1补caller原位状态、无关嵌套回执、副本/回调次数/异常身份、成功/失败后的状态和5个额外错误控制。

`4cb2937`的完整check确实失败：340项、338通过、1新增system通道失败、1旧Windows symlink权限跳过；日志`.probe-work/t061-check-4cb2937.log`。远端旧run42216519951也失败/取消，Ubuntu日志确认同一实际输入缺失断言，不作为通过。根因是context进入用户运行时通道；改用真正section系统通道，保留严格system断言，不放宽到用户消息搜索。

新版`e5d2d27`针对5/5通过：23项真实外部pytest控制（6 before失败、6 reference通过、11 wrong失败），18个实际脚本请求分别携带经验0/6、6/6、5/6。`f0a85cf51e87845fad4a85dce81620bb3612c53e`再统一两个检索的脱敏256字符查询，核对真实task.summary和各组queryDigest。

最终生产准备代码f0a85cf本机完整`npm run check`确实通过：341项，340通过、0失败、1项旧Windows symlink权限跳过，日志`.probe-work/t061-check-v1.1.log`；包括类型、lint、构建和完整新增5项。`npm run compat`10/10、无跳过，日志`.probe-work/t061-compat-f0a85cf.log`。网站仅本机构建/检查通过：22页、635处本地引用/锚及公开白名单；没有部署。

稳定`f0a85cf`独立只读复审无P0/P1/P2，另以纯内存Python复核全部23个控制、原v1归档字节、每题第二轮换位、真正系统角色/温度0/2048/无工具与统一查询。评审者未运行完整预检或付费模型，AI不是GitHub批准。文档/最终提交/CI仍各自核对，不继承旧SHA通过；远端最终结果直接看[PR #136检查](https://github.com/wang1299/dsh-reforge/pull/136/checks)。

[公开准备回执](../evaluation/benefit-preparation-v1.1.json)为f0a85cf本机完整预检实际产物，3份独立来源、23项控制、18次脚本输入、36项未启动计划；模型HTTP0。题目89b3f295…、方法884c10dc…，含实际编译入口和源文件起止一致检查，不冒充完整live依赖冻结。[Draft PR #136](https://github.com/wang1299/dsh-reforge/pull/136)叠在PR #134冻结分支上；两个PR都未合并，本次无部署授权。

公开数据仅为本轮合成控制/结构化摘要，不上传旧profile或私人日志。脚本固定输出没有修复，不提供真实模型成功、返工、耗时节省或费用数字；后续live runner和新预算尚缺。本轮不读旧账本、不授额、不发送付费HTTP、不更新发行物。

## 2026-11-09：主分支基线与恢复测试

- PR #134已单独获得owner合并/官网授权，合并为`14af78c7dcb2f1435ae687e1dedacfa1ab55f2d0`；Pages run42545300148 build/deploy均成功，实际浏览器确认首页与新增维护文字，主目录已同步。main run42545300168四组合均成功。没有发布npm或Release。
- T061原`c9150b8`在同SHA有限复跑后四组合全部通过，各341项、compat10/10、同包摘要`2992a507ed5e1d5bb871895bff9f619c2ff921af`和安装/学习通过；首轮Windows旧feedback测试60秒超时仍保留。复跑该测试实际19.08秒通过，不能声称已修复偶发超时。
- PR #136已以main为base。ancestry提交`ed250ebd71aecda00ddbcdda25bd4f84744537cd`与c915文件树完全相同，经独立只读复核；但其新run42546627118的Windows出现另一旧恢复用例失败（open而非unknown），另一Windows被fail-fast取消。没有沿用旧SHA绿灯。
- 原恢复测试把“子进程已退出”直接当成恢复时PID仍确定不存在。运行时只在当时OS回执ESRCH时恢复，存活/不可访问身份应保留。现在保留实际退出子进程测试，在真正恢复调用处记录OS回执；另用独立仓库分别严格核对ESRCH→unknown/closed且重复输入不重开、EPERM/alive→保留原owner/open且不产生新任务/job/grant。生产恢复代码未改。
- 新测试最初误用同仓库三路捕获触发并发保护，并误把open身份查询也预期为null；两次针对失败记录保留在本机，已改为独立场景与仅对确认死亡断言重复输入拒绝。最终9/9、0跳过通过，日志`.probe-work/t061-recovery-receipts-final.log`；构建/类型通过，lint与新SHA四组合CI仍须核对。数据/方法历史摘要不重写，不把测试修正当模型收益。

PR #136仍未合并；PR #134的部署授权不代替本增量授权。后续有界修复控制器另行开发，真实收益、live费用与新预算仍未完成。
