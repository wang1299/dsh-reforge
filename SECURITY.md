# 安全报告 / Security reporting

实验性 alpha，兼容范围见[版本状态](docs/release-status.md)。仅对自己信任的代码开启执行；隔离工作区不是恶意代码沙箱。

请勿把 Key、完整会话、认证地址、私人配置、数据库、快照或任意工具原始输出贴到公开 Issue。普通问题用[问题表单](https://github.com/wang1299/dsh-reforge/issues/new/choose)，仅提供脱敏版本和最小合成复现。

疑似漏洞：若仓库 Security 页显示 **Report a vulnerability**，请使用该私密入口；若未显示，当前没有已确认可用的私密报告通道。先开一个仅写“请求建立私密安全联系渠道”的 Issue，不包含漏洞细节或敏感附件，等待维护者提供渠道。不要将尚未建立的入口理解成已经启用的私人报告服务。

This experimental alpha runs trusted repository code; workspace isolation is not a hostile-code sandbox. Never publish keys, conversations, token URLs, full configuration, databases or snapshots. For a suspected vulnerability, use GitHub's **Report a vulnerability** only if that private entry is available. Otherwise request a private contact channel in an issue without details or attachments; a private channel has not been confirmed. Ordinary bugs should use redacted synthetic reproductions in the issue forms.

修复与支持优先当前公开 alpha 和源码候选；不承诺响应时限、未验证宿主或追溯维护所有旧版本。安全修复仍需来源、边界测试与发行核验。
