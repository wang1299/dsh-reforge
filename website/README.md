# DSH-Reforge 官网

独立官网与任务导向文档。设计边界见 [ADR045](../docs/decisions/045-public-website.md)，任务见 [T051](../docs/tasks/T051-public-website.md)。

Sites初次发布虽返回成功，用户与内置浏览器都无法访问，因此通过[ADR046](../docs/decisions/046-github-pages-fallback.md)新增本仓库GitHub Pages入口。当前公开地址、发布及实访回执见[Issue #116](https://github.com/wang1299/dsh-reforge/issues/116)。Pages工作流从官方configure-pages读取base_url，使用WEBSITE_URL注入构建；不得把预期URL或成功上传当作已可访问。

根路径和项目子路径均由网站CI检查。手动检查子路径可在构建前设置`$env:WEBSITE_URL='https://example.invalid/dsh-reforge/'`；预览服务会打印相应本机子路径。默认site.json和Sites身份保留，未更改旧Site安全策略。GitHub Pages只发布33个静态文件，权限限于本仓库main的Pages发布/OIDC；不创建PAT或密钥。

```powershell
cd website
npm ci --ignore-scripts
npm run build
npm run check
npm run dev
```

在终端打印的本机 URL 预览。Node.js >=24.10；CI 使用24.19.0。页面没有模型调用、账号表单、经验上传或遥测。复制命令失败会明确提示手动复制，不冒充复制成功。视频使用现有公开合成案例，字幕从对应公开SRT转换为VTT。

构建读取 `build.mjs` 中明确列出的Markdown、品牌图、视频和字幕；不遍历 `.probe-work`、运行目录或私人配置。新增文档须同时维护导航和白名单。站内链接与锚点、两语言、标题、媒体、白名单及私人路径由 `npm run check` 核验；网页可用性另行在浏览器验证。当前22页。外部未选入文档回到GitHub，中文原文中的跨语言锚点保留原文定位。

`site.json` 保存公开版本与注册时返回的预期origin；预期URL不等于已发布。`.openai/hosting.json` 只保存Site标识和静态目录。`dist/` 为忽略的构建输出，不加入npm包。发布只将审查后的官网文件及输出复制到仓库内独立、忽略的Sites检出，由官方source helper提交/打包，不能在主仓库使用它的全量stage。凭据只经隐藏stdin传递，不保存到文件或Git。独立评审、所需CI和合并后才公开部署；真实部署回执见任务/Issue。
