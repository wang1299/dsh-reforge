# T050：alpha.2公开发行

2026-11-04，[Issue #113](https://github.com/wang1299/dsh-reforge/issues/113)，实施前设计[ADR044](../decisions/044-alpha2-release.md)。属于用户逐项补齐要求中的公开版本；与T049真实证据一并在PR #111准备和审查，实际发布在合并及最终主分支CI之后进行。

当前：发行工作流仅允许本仓库精确alpha.2 tag，并强制实际主分支CI和四组合检查。新包尚未发布；npm登录已过期，待稳定制品准备完成后在本机重新登录。不会索要聊天中的Key、密码或验证码。准备代码不等于完成公开发行。

验收顺序：稳定SHA独立评审 → CI/分支规则 → 合并 → 最终main CI → 干净构建/具体包审计与试装 → owner本机npm认证 → 发布冻结tgz并核对注册表/公开下载 → alpha/latest指向新包 → annotated tag绑定源/摘要 → GitHub prerelease三资产 → 公开下载/摘要/安装核验 → 更新版本状态与Issue。每一步记录实际结果，失败先只读核对，不覆盖已发行版本。
