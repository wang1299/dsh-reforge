# 版本、兼容与证据 / Version, compatibility and evidence

公开元数据与下载摘要核对 / Metadata and downloaded hashes checked: **2026-11-09**。下方安装/模块验证保留2026-11-05的原验收日期，不改标为本次重跑。发行状态以 npm 注册表和 GitHub Release 的实际制品为准，源码或本机 tgz 不能代替公开发行。

源码集成范围 / Source integration scope: [T068](tasks/T068-source-integration.md)覆盖T061–T067研究入口、只读结果页与运行检查改进；main/官网的实际交付状态见关联集成PR。官网更新不发布npm包；公开alpha.2不会自动获得这些源码功能。

| 制品 / Artifact | 宿主 / Host | 状态 / Status |
|---|---|---|
| [npm 0.1.0-alpha.1](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1) | 仅 / only 0.2.0-rc.2 | 已公开 / Published |
| [Release v0.1.0-alpha.1](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.1) | 同上 / same | 已公开并核验摘要 / Published and hashes checked |
| [npm 0.1.0-alpha.2](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.2) | 精确 / exact 0.2.0-rc.2、0.2.1-rc.5 | 已公开；发布者与公开下载摘要核验通过 / Published; publisher and download hashes verified |
| [Release v0.1.0-alpha.2](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.2) | 同上 / same | 已公开；3个附件已下载核验 / Published; all 3 assets downloaded and verified |

alpha.2包含Tabler风格工作台、配置/诊断与备份恢复工具；[视频同款完整工程](../examples/customer-form/README.md)在源码仓库中单独运行。Windows/Linux两版本SDK、同包安装和离线自动学习范围见[兼容指南](dsh-version-matrix.md)。alpha.1保留原宿主/界面范围；未知宿主继续拒绝，不能用放宽版本范围代替适配。

Alpha.2 includes the Tabler-style workbench and conservative owner tools. Run the matching complete example separately from the source repository. See the [matrix scope](dsh-version-matrix.md) for exact SDK, installation and offline-learning coverage. Historical alpha.1 retains its original scope; unverified hosts remain rejected.

发行源码 / Release source: [`adfee5766787983deeacadd4392ce36a5ae78e3d`](https://github.com/wang1299/dsh-reforge/commit/adfee5766787983deeacadd4392ce36a5ae78e3d)，[对应main CI](https://github.com/wang1299/dsh-reforge/actions/runs/41814369960)四组各246测试+9兼容全部通过、0跳过。安装包177,879字节/105文件；50个产品JS与真实模型试验候选逐文件相同。公开下载已核对publisher **wang129**，SHA256：

```text
d77ed34815109823e41ffd89a6e91306105061ded9fb0b6e47b7387320516610
```

`alpha`和`latest`是可变安装入口，实际值以[注册表实时响应](https://registry.npmjs.org/-/package/dsh-reforge/dist-tags)和[本轮迁移回执#113](https://github.com/wang1299/dsh-reforge/issues/113)为准。复现本发行请锁定 `dsh-reforge@0.1.0-alpha.2`；不能将一个标签视为永久兼容保证。本页代码/制品证明不替代下方真实效果证据或外部试用。

2026-11-09重新查询时，两个标签均为alpha.2；npm与GitHub API附件实际下载均177879字节、SHA256均为上方d77ed348摘要，npm SHA1/integrity及GitHub的SHA256SUMS/release.json摘要也一致，release.json仍指向adfee576源码。最初浏览器下载URL超时未计为通过，改经公开API附件下载后完成。没有执行公开包中的代码、改标签或发布新制品；旧安装证明的范围保持原记录。

GitHub [发行任务](https://github.com/wang1299/dsh-reforge/actions/runs/41866913517)已成功；公开tgz、`SHA256SUMS`、`release.json`全部核验，GitHub/npm/冻结包字节完全一致。新profile从npm精确版本直接安装到官方DSH0.2.1-rc.5通过，50个产品模块匹配；公开下载的同一tgz在旧0.2.0-rc.2的官方profile/Loader/七工具探针通过。以上试装零模型调用，不操作默认Desktop或旧体验库。

| 证据 / Evidence | 当前结论 / Current conclusion |
|---|---|
| 视频与完整示例 / Video and runnable example | 合成数据、显式补丁、实际独立测试，零模型调用 / Synthetic explicit patch, real independent checks, zero model calls |
| 自动学习 / Automatic learning | [本轮真实安装包/官方SDK闭环通过](evaluation/t049-20261104/README.md)：1经验/1应用/0反馈、提炼1次 / Actual bounded synthetic loop passed |
| 后续收益 / Future-task benefit | 三组均4/4；两检索均拒选，未测到实际使用经验效果 / 4/4 in every arm; both retrieval arms abstained, no memory treatment observed |
| 外部试用 / External trial | [公开入口#112](https://github.com/wang1299/dsh-reforge/issues/112)已开放；真实参与仍为0 / Public call open; 0 actual participants |

另有未发行源码的[2026-11-09真实研究](evaluation/benefit-live-20261109.md)：36项、42次真实请求，三组均10/12、未观察到通过率/返工收益，峰值费用上界0.052672元（非账单）。[运行检查P50降低48.7%](evaluation/runtime-freeze-performance.md)是单机工程微基准，不是公开alpha.2或模型质量的新成绩。两项证据与上表alpha.2历史验收分别保留。

下一步与逐项进度 / Next steps: [T046](tasks/T046-public-readiness.md)。
