# T068：累计源码集成与官网批准提案

2026-11-09 / [Issue #149](https://github.com/wang1299/dsh-reforge/issues/149)，分支`codex/t068-source-integration`。这是main与公开状态的一次集成准备，不新增模型能力、付费许可或默认后台工作。

## 提案与准确范围

已只读核对远端main为`14af78c7dcb2f1435ae687e1dedacfa1ab55f2d0`；当前7组源码仍在[PR136](https://github.com/wang1299/dsh-reforge/pull/136)、[138](https://github.com/wang1299/dsh-reforge/pull/138)、[140](https://github.com/wang1299/dsh-reforge/pull/140)、[142](https://github.com/wang1299/dsh-reforge/pull/142)、[144](https://github.com/wang1299/dsh-reforge/pull/144)、[146](https://github.com/wang1299/dsh-reforge/pull/146)、[148](https://github.com/wang1299/dsh-reforge/pull/148)中。以实际main到b3b262e的92文件差异为依据，而不是把旧squash合并前的祖先提交重复计为新改进。

提案统一集成这些源码及相应文档：冻结作者合成任务、已知失败/未知分母、有界官方SDK控制器、独立单计划费用账本、默认未授权的真实执行入口、原始Key/子进程隔离、受限pytest、只读报告与计时、16-walk冻结检查。ADR055–061与各阶段检查继续保留。主库SQLite v9、用户profile、预算/未知占额/已用提炼次数、默认学习与模型授权不改变；没有数据清理或自动重放。

真实证据不改写：[T065](../evaluation/benefit-live-20261109.md)仍为三组均10/12、0个百分点改善；42真实请求与0.052672元峰值上界不是发票。[T067](../evaluation/runtime-freeze-performance.md)的48.7%仅指e96f425上单机公开Node闭包的检查P50，不是模型质量或整场试验提速。后续反馈干预仍需新冻结计划及明确预算。

## 公开制品和部署只读核对

- 2026-11-09公开npm的latest/alpha均为`0.1.0-alpha.2`。重新下载npm tgz与GitHub API Release tgz，均177879字节，SHA256为`d77ed34815109823e41ffd89a6e91306105061ded9fb0b6e47b7387320516610`；npm SHA1/integrity、GitHub SHA256SUMS及release.json附件摘要均匹配。release.json仍绑定adfee576源码。初次浏览器下载URL的504保留为失败尝试，未假称摘要不一致；随后公开API下载实际通过。未执行下载包、改标签或发布。
- GitHub的alpha.1/alpha.2均为公开prerelease，所以latest稳定Release端点404不代表附件不存在；实际以发布集合与附件为准。
- main分支API返回protected=false，包含父级的rulesets集合为空；未修改权限、账户、分支保护或部署设置。仍按项目验收、CI、文档与独立审查规则准备集成。
- 已核对`.github/workflows/pages.yml`：合并涉及docs/package等路径到main会自动构建并部署GitHub Pages。因此只有具体集成候选的验收/CI/审查完成后，才请求本次main合并与官网更新的单独批准。不在此范围发布npm包、GitHub Release或修改市场收录。

## 集成门槛

本提案尚未批准合并/部署。准备后的稳定SHA须完成累计只读审查、最终头四组合完整CI（含同候选安装与学习控制）、网站root/项目路径构建检查及测试merge与head的tree一致性核对。T067和更早的绿灯是分片证据，不冒充最终集成头结果；AI审查不当作GitHub正式批准。实际终态写在集成PR中。

已完成的分片证据：18a6654本机414项中411通过、3个Windows文件symlink权限skip、0失败，compat10/10；独立页旧/矛盾/清除/键盘/390px检查通过。精确srcdoc/sandbox/CSP的纯合成宿主导入由所有者在系统浏览器手工确认，不称为完整原生DSH或自动化验收。所有模型/费用控制CI均使用合成响应，真实模型请求0。

批准后才执行main合并并跟踪Pages真实部署与公开页面；当前不把提案、静态构建或工具返回当作已公开部署。持续UX与真实效果目标仍开放。
