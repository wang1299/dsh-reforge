# 第一次使用：从体验到正式配置

[English](quickstart.en.md) · [文档首页](../index.md) · [当前版本](../release-status.md)

## 1. 先跑不需要 Key 的完整案例

按[客户表单示例](../../examples/customer-form/README.md)启动。复现失败、应用提供的补丁、运行独立验收，在经验面板看到一条来源验证经验。通过标准是原始 2 项失败、修复 2 项通过、回归 3 项通过；不要只看按钮颜色或完成提示。

这一段无需 DSH，不会产生模型费用。示例每次使用新的独立目录；它不是自动学习或收益演示。

## 2. 选择能安装的版本

先看[发行状态](../release-status.md)和[精确矩阵](../dsh-version-matrix.md)。本发行alpha.2支持 DSH 0.2.0-rc.2 / 0.2.1-rc.5；旧alpha.1只支持前者。公开状态未确认时可先跑第一步，勿用旧包代替或降级业务环境。

## 3. 只读绑定自己的仓库

alpha.2提供 `setup` / `doctor`，无需先手写JSON。下列入口适用于第一步示例所在的已构建源码目录，不要求全局CLI在PATH；旧alpha.1没有这些命令：

```powershell
node dist/src/cli.js setup --repo 'C:\work\my-python-project' --output 'C:\local-config\reforge.json' --python 'C:\path\to\python.exe'
node dist/src/cli.js doctor --config 'C:\local-config\reforge.json'
```

setup 不覆盖已有文件，四项权限全关闭，不生成提炼授权；可另用 `--data-dir` 指定数据目录。doctor 输出可读类别、状态和计数，不显示私人路径/配置，不调用模型或新建数据库。`warning` 中“宿主需 owner 核对”“未联系模型”表示尚未检查，不是连接成功；`error` 时先解决对应问题，勿删库重置。模型登录在本机 DSH 内完成，不把 Key 交给插件。

按[安装指南第 1–2 节](../installation.md#1-准备环境和配置)创建本机配置，先保持所有学习/共享/执行权限关闭。在安装所用的同一 profile 启动 DSH，用本次终端打印的完整认证地址打开插件详情。首次应能看到正确仓库与只读模式；空经验是正常状态。不要把 Key 写进插件配置。

## 4. 再决定是否开启学习

为自己信任的 Python 工程准备**仓库外独立验收**，指定实际 Python 路径和仓库内回归目录。阅读[权限与提炼授权](../installation.md#3-开启正常对话自动学习)，再由 owner 在本机分别开启执行、后台验证、共享和自动学习，给真实注册模型一次明确提炼授权。不要复制示例中的 grantId 或通过改名重置次数。

后台提炼次数不等于人民币预算；正常 DSH 对话也可能计费。不开启时仍可正常对话，插件不要求自动学习才能使用 DSH。先从一条不含私人资料的小修复开始。

## 5. 核对结果，再尝试后续任务

在“学习进度”核对记录、原失败/修复/回归、提炼和独立复核。失败、跳过或 unknown 应保留原因。下一适用请求的“提供参考”记录表示插件提供过某一版本；模型是否采用、任务是否成功和是否因经验改善需另外验收。

升级前看[数据运维](../maintenance.md)，卡住时看[FAQ](../faq.md)。报告问题只提供脱敏版本、失败步骤和预期/实际结果。
