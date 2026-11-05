# ADR046：官网 GitHub Pages 公开入口

2026-11-05，实施前决定。延续用户已明确要求的独立对外官网与[Issue #116](https://github.com/wang1299/dsh-reforge/issues/116)。T051的Sites版本1虽返回部署成功，内置浏览器实际显示Cloudflare拦截，用户又确认系统浏览器也无法打开，公开访问验收未完成。保留该Site身份、制品与回执，不绕过拦截或降低安全策略。

为同一已审查静态网站新增当前GitHub仓库自身的GitHub Pages入口。只配置本仓库Pages的GitHub Actions发布来源；不创建新仓库、PAT、密钥、自定义域名或账户安全设置。使用GitHub官方configure-pages、upload-pages-artifact和deploy-pages；发布URL从平台元数据读取，不将预期地址当作已经上线。

网站构建支持根路径与项目子路径，所有站内导航、样式、脚本、媒体、语言切换、canonical与sitemap必须一致。默认保留Sites根路径配置；Pages通过官方base_url注入公开URL。两种路径均运行构建/协议/白名单/635处引用与锚点检查；浏览器验证子路径入口、复制、文档与媒体。新增工作流只允许本仓库main构建发布，部署权限仅限Pages与OIDC，不发布插件包。

稳定SHA独立只读评审、所需CI和分支规则通过后合并；通过官方Pages工作流发布已合并源。访问新公开URL，确认页面及关键资源真实可用后，再更新GitHub Website和文档的官网入口。仅上传33个明确白名单静态文件。保持模型、SQLite、旧经验、预算/unknown和授权不变，零付费模型调用。
