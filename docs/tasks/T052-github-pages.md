# T052：修复官网公开访问

2026-11-05，延续[T051](T051-public-website.md)与[Issue #116](https://github.com/wang1299/dsh-reforge/issues/116)。用户确认Sites地址在系统浏览器也无法访问。实施前决定：[ADR046](../decisions/046-github-pages-fallback.md)。

目标：在同一GitHub仓库用官方GitHub Pages发布现有官网，修正项目子路径的导航、媒体、样式、语言与搜索元数据；验证根路径和子路径构建，检查实际公开页面后更新仓库Website。代码、评审、CI、合并与实际URL分开验收。最终部署和浏览器回执以Issue实时记录为准。

原Sites制品/身份保留；不更改其安全策略、不上传私有数据、不新增模型调用，不重发npm或Release。
