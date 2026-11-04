# DSH 多版本兼容与适配维护

本页说明 `dsh-reforge@0.1.0-alpha.2` 的精确验收范围。历史 npm alpha.1 仅支持0.2.0-rc.2；本发行的公开核验见[版本状态](release-status.md)，源码、安装验证和公开发行分别记录。

## 版本矩阵

| DSH | 候选声明 | SDK 锁定 | 必须完成的检查 |
|---|---|---|---|
| 0.2.0-rc.2 | 精确列入目标 | 根 package-lock.json | Windows/Linux 类型、静态、完整测试、契约、同包安装和脚本学习 |
| 0.2.1-rc.5 | 精确列入目标 | compat/dsh-0.2.1-rc.5.lock.json | 同上，额外验证新的 owner/浏览器身份及 carrier 拒绝非owner |
| 其他版本 | 不允许隐式扩大 | 无 | 先适配和验收再增加，不使用版本例外绕过 |

实际完成结果、原始失败与CI链接记录于 [Issue #93](https://github.com/wang1299/dsh-reforge/issues/93) 和关联PR，尚未执行的检查不计通过。脚本模型不发送付费请求，不证明实际模型质量或未来任务收益。

## 边界

- `dsh-adapter-host.ts`：工具、会话、Agent、生命周期，沿用核心拥有的配置与能力授权。
- `dsh-adapter-model.ts`：核心 ExtractionPort 到官方一次性prepared call和有界流；不读取Key，不重试未知调用。
- `dsh-adapter-rpc.ts`：官方认证载体、owner身份、32KiB、repoId与revision；不接收请求体中的身份。
- `dsh-adapter-client.ts` / `dsh-adapter-schema.ts`：官方页面/导航/槽位与工具DSL，复用核心视图与验证。
- `dsh-adapter-policy.ts`：精确已测目标。公开facade和既有evolve工具输入保持。

rc.2 的 Connection 提供 `operator`，rc.5 提供 `browserPeer`；新版共享载体要求调用方明确传入获准Peer，并在精确Fetch路由进入前拒绝非owner principal。适配层只从实际官方连接对象取得owner，不从请求体构造或认可身份；保留认证、来源、限长与写入版本保护。两版真实Connection组件的负路径都必须验证。

核心 `service` / `domain` / `store` / 自动学习/来源验证/HTTP面板不导入官方SDK；静态回归防止依赖回流。此次不变更SQLite9、默认dataDir、repoId、历史用量指纹、grant或unknown记录。私人profile不自动试装，不能与旧实例同时操作同一库。

## 本机运行

```sh
npm ci --ignore-scripts
npm run compat:matrix
# 仅检查一个已列入的宿主
npm run compat:matrix -- --version 0.2.1-rc.5
```

命令先在基准SDK构建并审计一次候选包，然后将受Git管理的项目源文件复制到ignored隔离目录，各SDK用对应锁文件 `npm ci --ignore-scripts`。不修改根node_modules、原profile或当前DSH Desktop。两份矩阵安装同一tgz，安装后的所有产品JS与当前构建逐字节比较，版本家族必须一致。报告保存在 `.probe-work/dsh-matrix-*/report.json`；`--typecheck-only` 仅供接口排查，明确不是完整矩阵验收。

实际组件、官方安装器与完整应用的范围分开。Windows/Linux CI不等于完整Desktop UI E2E；独立完整宿主额外试装、认证与页面入口结果也须单独记录，不把预检通过或单一工具成功当作完整学习成功。

## 后续增加宿主版本

1. 查清该固定官方发行的契约变化，先补能重现问题的测试；接口/生命周期变化先ADR。
2. 在ignored目录生成该SDK的独立manifest与锁文件，所有官方DSH开发依赖锁为同一版本；提交脱敏锁文件，不使用force/legacy-peer-deps或版本例外。
3. 仅在适配模块处理差异，核心不添加按宿主版本分支。旧支持版本的测试继续保留。
4. 在支持策略、manifest的精确peer并集及CI版本行同时加入目标；回归会检查声明与矩阵一致，并拒绝相邻未经验证的预发布版本。
5. 同一候选包通过全部平台/版本和独立稳定SHA审查，记录完整应用边界后再交付。需要公开发行时另取明确授权，使用新版本，不改写alpha.1/tag/Release附件。

已覆盖范围内的官方更新可能直接可用；超出范围先测试，接口变化才需适配。此机制降低核心维护成本，不能保证任意未来版本兼容。
