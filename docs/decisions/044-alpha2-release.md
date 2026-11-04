# ADR044：精确绑定 alpha.2 的公开发行

2026-11-04，实施前决定。[T046](../tasks/T046-public-readiness.md)要求完成与源码一致的公开版本，owner已明确要求逐项补齐并授权npm包及GitHub Release；[Issue #113](https://github.com/wang1299/dsh-reforge/issues/113)。不更改账户、认证或安全策略。

保留alpha.1制品及其历史tag，新增一次精确 `v0.1.0-alpha.2` 发行。当前任务的代码、证据报告、文档和发行脚本通过稳定SHA独立只读评审与双平台双宿主CI后才合并；最终主分支提交也须四组合CI通过，才从干净构建生成白名单tgz。冻结包及摘要后不再重新打包，npm仅发布这个具体文件，由owner在本机完成需要的登录/2FA。

核对公开注册表publisher wang129、版本、仓库、完整性及公开下载字节后，alpha和latest均指向alpha.2（此前latest已是alpha.1实验包）；这样不指定版本的市场安装可取得兼容新旧受测宿主的新版。此举不将实验包宣称为稳定版，不更改已发布alpha.1。发布失败/状态不明先只读核对，不盲目重试或换包覆盖。

annotated tag必须绑定源提交、包名/版本/publisher、npm sha512完整性与sha1。GitHub workflow仅允许本仓库这个精确tag，恢复远端annotated对象后验证；使用现有GITHUB_TOKEN和Actions自带gh，不新增密钥或npm可信发布账户配置。脚本重新下载并审计注册表的真实tgz，草稿上传tgz、SHA256SUMS和有界release.json，核对三资产后才发布为prerelease且不标GitHub latest。已存在同tag Release必须停止人工核对，不能覆盖或重复发布。

包内README说明本发行版本和精确兼容范围，公开“已发布”状态以可变的版本状态页/Issue实际核验更新。源码检查、真实自动闭环、未来任务收益、外部参与及市场收录分别说明；T049两检索均拒选的结果不能改写为收益证明。所有学习数据、私人配置、凭据、plan、完整会话、临时工程排除于包和Release。
