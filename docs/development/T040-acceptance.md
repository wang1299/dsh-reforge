# T040：独立适配层与版本矩阵验收

设计 [ADR039](../decisions/039-dsh-version-adapters.md) 在实现前提交；Issue #93。基线 a674314，候选alpha.2，未公开发布。验收结果、稳定SHA审查与最终CI/合并以 [Issue #93](https://github.com/wang1299/dsh-reforge/issues/93) 和关联PR为准，不提前计完成。

## 实际失败与修复

1. 修改前两项回归真实失败：官方evaluatePluginCompatibility拒绝0.2.1-rc.5，SDK边界扫描检出旧入口直接依赖官方包。失败先于实现提交。
2. 隔离的新SDK图首次直接沿用旧锁图出现npm依赖冲突，没有使用force/legacy-peer-deps。为每个SDK保留独立固定锁图，用npm ci严格安装，所有官方DSH开发依赖逐项核对同版本。
3. 新SDK实际类型检查发现7项错误：operator字段、OperatorPeer导出与共享Fetch调用参数变化。owner身份按固定官方SDK映射，测试使用该SDK真实Connection服务和载体；新版非owner principal在实际载体入口被拒绝。没有将请求体当身份，没有扩大授权或去掉32KiB/repoId/revision保护。
4. 旧SDK针对检查10/10、新SDK针对检查11/11已通过；完整矩阵与实际同包安装结果记录于Issue，先前失败保留。源核心/SQLite9/用量指纹/预算逻辑无修改。

## 证据层次

- 核心与边界：静态扫描只允许适配模块import官方SDK；核心经验、来源、存储、验证不按宿主版本分支。
- 声明：策略/manifest精确并集/四个CI组合一致，相邻未测预发布版本拒绝；公共入口在创建Store前核对实际app-boot版本。
- 矩阵：同一审计tgz分别安装，两份SDK家族与锁图摘要、所有产品JS、工具/会话/来源拒绝/取消/卸载、模型坏流、原生身份与状态保全、脚本学习正负路径。
- 数据保全：原同库profile升级回归保留v9每一行、经验1/应用1/反馈0、已耗尽grant1/1与unknown，并验证模型调用不发生；该回归在两个SDK矩阵都执行。
- 应用范围：真实组件与官方包管理操作不等于完整Desktop应用E2E。独立完整CLI/Web的额外加载、认证和页面入口结果单独记，未执行部分明确保留。

## 发行与私人环境

首发alpha.1的准确版本/源提交/SHA256/SHA512/SHA1和原仓库身份继续审计；原tag、npm字节及Release附件不改。候选使用新版本号，当前来源和历史发行分开。本轮未改变真实Desktop profile、凭据、SQLite/快照、预算与授权，未发起付费模型调用或公开发布。
