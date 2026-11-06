# 从工程契约读取事实

此源码案例演示有限Schema事实获取，不调用模型，不读取DSH配置/旧经验/账本，不写原工程。需要Node24及本仓库开发依赖。

```powershell
npm ci --ignore-scripts
npm run project:facts
```

输出中的`report`是仓库内新建的本机HTML报告，用浏览器打开即可。默认检查公开的`customer.schema.json`：alias可以省略、允许null、非null声明类型为文本；目标明确标为**示例预设**，不冒充你的实际任务。报告有来源、未知原因、目标说明、重新检查命令及复制反馈；这是静态快照，文件变化后需重新运行。

检查自己的明确目标时，在仓库内给出相对路径、属性及目标：

```powershell
npm run project:facts -- examples/project-facts/customer.schema.json alias validate_payload
npm run project:facts -- examples/project-facts/customer.schema.json alias present_ui
```

目标有`validate_payload`（修复输入校验）、`change_contract`（修改契约）、`present_ui`（调整界面）、`generate_docs`（文档）。不提供第三项时目标保持未知；不会从任务文字补猜。你仍需指定文件、属性和目标，只是不用手写三项事实JSON；这不等于零配置或自动自然语言理解。

```powershell
npm run project:facts -- examples/project-facts/composed.schema.json alias validate_payload
```

这个合法的allOf示例超出首版支持范围，报告保留未知，不能建议删去契约来通过检查。支持范围见[ADR053](../../docs/decisions/053-project-schema-facts-and-goals.md)：有限显式draft-07、根object、type/required/布尔additionalProperties及有限注解。拒绝组合/引用/enum/嵌套约束、未知方言、越界/隐藏/敏感路径、链接及超8KiB来源。源文件只读，报告只显示有限事实和定位，不展示原始注解/default值。

自动验收公开默认案例：`npm run project:facts -- --check`。它核对真实读取与报告生成，不代表真实Agent任务成功。事实获取、明确目标检查和独立五臂效果对照分开；当前未接正常DSH选择或公开npm安装包。Schema声明不证明程序行为，default不代表标准校验会补值。

English: source-only zero-model demo. Run `npm run project:facts` for a public preset, or pass a repository-relative `.schema.json`, property and explicit goal. The local HTML is a static snapshot. No user profile or ledger is opened; unsupported schemas remain unknown. The default goal is labeled as a demo preset, not owner intent. This is not NLP, default DSH integration or downstream Agent-benefit evidence.
