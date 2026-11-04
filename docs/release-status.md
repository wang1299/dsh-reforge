# 版本、兼容与证据 / Version, compatibility and evidence

核对日期 / Checked: **2026-11-04**。发行状态以 npm 注册表和 GitHub Release 的实际制品为准，源码或本机 tgz 不能代替公开发行。

| 制品 / Artifact | 宿主 / Host | 状态 / Status |
|---|---|---|
| [npm 0.1.0-alpha.1](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1) | 仅 / only 0.2.0-rc.2 | 已公开 / Published |
| [Release v0.1.0-alpha.1](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.1) | 同上 / same | 已公开并核验摘要 / Published and hashes checked |
| 源码 / source 0.1.0-alpha.2 | 精确 / exact 0.2.0-rc.2、0.2.1-rc.5 | 开发候选，未发行 / Development candidate, unpublished |

alpha.2 已有 Windows/Linux 两版本 SDK、同包安装和离线自动学习矩阵，具体范围见[兼容指南](dsh-version-matrix.md)。Tabler 风格工作台与视频同款案例属于新源码；不能承诺安装 alpha.1 得到相同界面。未知宿主继续拒绝，不能用放宽版本范围代替适配。

The alpha.2 source has Windows/Linux checks for both exact SDK graphs, same-package installation and offline automatic-learning paths. See the [matrix scope](dsh-version-matrix.md). The Tabler-style workbench and matching runnable case belong to the new source, not the published alpha.1. Unverified hosts remain rejected.

| 证据 / Evidence | 当前结论 / Current conclusion |
|---|---|
| 视频与完整示例 / Video and runnable example | 合成数据、显式补丁、实际独立测试，零模型调用 / Synthetic explicit patch, real independent checks, zero model calls |
| 自动学习 / Automatic learning | [本轮真实安装包/官方SDK闭环通过](evaluation/t049-20261104/README.md)：1经验/1应用/0反馈、提炼1次 / Actual bounded synthetic loop passed |
| 后续收益 / Future-task benefit | 三组均4/4；两检索均拒选，未测到实际使用经验效果 / All4/4; both retrieval arms abstained, no memory treatment observed |
| 外部试用 / External trial | [公开入口#112](https://github.com/wang1299/dsh-reforge/issues/112)已开放；真实参与仍为0 / Public call open; 0 actual participants |

下一步与逐项进度 / Next steps: [T046](tasks/T046-public-readiness.md)。
