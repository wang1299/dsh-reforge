# T050：alpha.2公开发行

2026-11-04，[Issue #113](https://github.com/wang1299/dsh-reforge/issues/113)，实施前设计[ADR044](../decisions/044-alpha2-release.md)。属于用户逐项补齐要求中的公开版本；与T049真实证据一并在PR #111准备和审查，实际发布在合并及最终主分支CI之后进行。

2026-11-05实际结果：npm `dsh-reforge@0.1.0-alpha.2`已公开，publisher `wang129`；annotated `v0.1.0-alpha.2`与[GitHub prerelease](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.2)已创建。[发行workflow41866913517](https://github.com/wang1299/dsh-reforge/actions/runs/41866913517)成功，3个公开附件逐一下载验证。可变`alpha/latest`迁移的实际回执单独记于[Issue #113](https://github.com/wang1299/dsh-reforge/issues/113)，复现安装锁定精确版本；实际制品状态见[版本状态](../release-status.md)。以下顺序是保留的验收方案。

验收顺序：稳定SHA独立评审 → CI/分支规则 → 合并 → 最终main CI → 干净构建/具体包审计与试装 → owner本机npm认证 → 发布冻结tgz并核对注册表/公开下载 → alpha/latest指向新包 → annotated tag绑定源/摘要 → GitHub prerelease三资产 → 公开下载/摘要/安装核验 → 更新版本状态与Issue。每一步记录实际结果，失败先只读核对，不覆盖已发行版本。

## 已完成的制品与源码核验

- 固定源码 `adfee5766787983deeacadd4392ce36a5ae78e3d`，原PR稳定头36c7816经独立只读复核；[对应main CI41814369960](https://github.com/wang1299/dsh-reforge/actions/runs/41814369960)四组合各246+9全通过、0跳过。
- 冻结后未重新打包：177,879字节/105白名单常规文件，SHA256 `d77ed34815109823e41ffd89a6e91306105061ded9fb0b6e47b7387320516610`。Npm注册表、GitHub附件及本机冻结包完全一致；50个产品JS与真实模型试验候选逐字节相同，文档差异导致两个候选tgz摘要不同。
- Npm本人在本机原生浏览器完成登录与发布2FA。服务端返回202后经历发布前扫描，公开后才核验publisher、sha512/sha1与下载字节，未重复发布。
- 公开`tgz`、`SHA256SUMS`和`release.json`均已下载核对；manifest/source/publisher/文件清单/摘要全部一致。独立冻结包审计无阻塞。
- 新profile用官方DSH0.2.1-rc.5插件管理器从npm精确版本直接安装，50模块匹配；注册表下载tgz在旧SDK0.2.0-rc.2的官方profile/Loader/七工具探针通过。全部试装0模型HTTP；默认Desktop、旧体验和已结清试验授权未重放。

## 默认标签客户端问题

原npm11.17的`dist-tag add`把PUT/body选项传给webOTP查询，导致验证查询误用PUT `/v1/done`并404。隔离复制公开npm客户端，只修改add方法的参数分离；原软件安装与账户/2FA设置不变。官方`DistTag→otplease→webAuthOpener→fetch`的无网络模拟复现原404，并证明修正后为GET查询→正常2FA→原定PUT标签。两项模拟与独立只读复核通过；模拟不读取凭据或私人配置，敏感值不写入输出或Git。真实标签更新须本人2FA并以公开dist-tags回执验收，不能把模拟成功当作已更新。
