# 安装与首次使用

包名 `dsh-reforge`，品牌 DSH-Reforge。首个实验性版本 `0.1.0-alpha.1` 已发布至 npm `alpha` 并通过公开安装；发行附件与最终结果见 [npm](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1)、[Release](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.1) 和 [Issue #75](https://github.com/wang1299/dsh-reforge/issues/75)。源码、本机 tgz 与远端公开结果分别核验。

## 版本选择

| 安装包 | 宿主范围 | 状态 |
|---|---|---|
| npm `0.1.0-alpha.1` | 仅 DSH `0.2.0-rc.2` | 原公开版本，不改写 |
| 源码 `0.1.0-alpha.2` 候选 | 目标 `0.2.0-rc.2` / `0.2.1-rc.5`，以本轮矩阵实际验收为准 | 未公开发布；使用经审计的本地 tgz 验证 |

若在 `0.2.1-rc.5` 中搜索到 alpha.1，安装器拒绝是正确的兼容边界，重试或关闭离线保护不能解决。不要强装、扩大版本例外或直接降级原数据库。后续兼容策略见[矩阵指南](dsh-version-matrix.md)。

## 1. 准备环境和配置

公开 alpha.1 固定 DSH `0.2.0-rc.2`；开发候选按上表选择精确宿主。Node.js ≥24.10。需要运行来源验证时，准备 Git、Python ≥3.10、pytest（CI 9.1.1），以及你信任的 Python 仓库。矩阵之外的 DSH 版本暂未验证；不要用版本例外绕过本项目的兼容声明。

创建一个不会提交到 Git 的本机 JSON 文件，例如只读体验：

```json
{
  "repoRoot": "/absolute/path/to/repository",
  "executionTrusted": false,
  "shareWithModel": false
}
```

将 `DSH_REFORGE_CONFIG` 设置为这个文件的绝对路径，供启动 DSH 的同一终端读取。PowerShell：

```powershell
$env:DSH_REFORGE_CONFIG = 'D:\my-local-config\reforge.json'
```

此处只是配置文件路径，不是 API Key。模型与凭据沿用 DSH 官方配置，插件不提供模型服务。若插件行直接配置了完整对象，该对象优先于环境变量。旧 `DSH_EVOLVE_CONFIG` 兼容；同时设置两个变量时必须指向同一真实文件，否则启动拒绝。

## 2. 安装并打开

在已安装固定版本 DSH 的终端执行：

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.1
```

从源码试装时，可运行 `npm ci --ignore-scripts`、`npm run build`、`npm pack`，将上面的包规格替换为生成 tgz 的绝对路径。本机重建包不能代替已发布版本的完整性证明。不要安装名为 `dsh-evolve` 的 registry 包，它属于其他项目。

停止旧 DSH 服务，使用同一个 profile 启动：

```sh
dsh web --profile web
```

打开终端打印的**完整认证地址**；直接输入裸 `127.0.0.1:端口` 可能被拒绝。请勿分享带认证参数的地址。进入左侧「插件」→「dsh-reforge」的详情操作页。配置仓库中的已有会话，也可从与「对话／轨迹」并列的「经验」标签进入。页面显示配置绑定的仓库，不会因切换对话而擅自切换数据目录。

默认没有经验，也不会提炼或执行测试。检查页面中的仓库和模式是否符合配置。打开面板不调用模型。

## 3. 开启正常对话自动学习

首次由仓库所有者在本机配置中设置以下字段。`acceptanceDir` 必须在目标仓库外，保存独立于 Agent 可修改代码的 pytest 验收。`regressionPath` 指向仓库内回归测试。验收文件必须能在原始代码上重现失败，在修复后通过；没有这样的测试时会暂停，不能凭 Agent 自称完成推断成功。

```json
{
  "repoRoot": "/absolute/path/to/repository",
  "acceptanceDir": "/absolute/path/outside-repository/acceptance",
  "regressionPath": "tests",
  "python": "python",
  "executionTrusted": true,
  "backgroundVerification": true,
  "shareWithModel": true,
  "automaticLearning": true,
  "extraction": {
    "grantId": "这里替换为你新生成的UUID",
    "provider": "your-registered-provider",
    "model": "your-registered-model",
    "maxCalls": 1,
    "maxTokens": 2048,
    "timeoutMs": 30000
  }
}
```

请使用 DSH **实际注册的** provider/model 路由；不是任意模型名。重新启动 DSH 后，正常提出 Bug 修复需求、必要时明确纠正即可；无需让 Agent 手动调用 `evolve_begin_task` 等工具。自动流程记录受限未提交快照，执行来源验证、一次候选提炼、独立再验，并在后续适用请求中提供经验。没有变化、材料不完整、原测试不失败、修复验收失败、版本漂移或额度不足都会说明原因。

开启前了解：

- 本地执行运行受信任仓库的代码，工作区隔离不等于安全沙箱。
- 模型共享会把有界的修复材料发到你选择的模型服务；不要用含私人数据或凭据的案例试用。
- `maxCalls` 只限制后台提炼逻辑次数，不限制整个 DSH 对话或服务商扣费。费用由用户与服务商控制，不内置人民币硬限。
- 未知调用不自动重放，不通过更换名字或重启清空次数。增加次数或重新授权需要所有者明确决定。

自动模式保存最多256字符的去敏请求摘要、少量最多512字符的明确纠正、消息标识及受限 tracked Python/依赖代码快照。单份快照最多500文件、单文件512KiB、总8MiB；128MiB为写前水位而非硬配额。快照跟随来源保留，当前没有自动彻底遗忘功能。不会保存完整会话/附件/任意工具输出，不会自动提交或回滚用户代码。

## 4. 如何知道流程成功

在「学习进度」查看「记录变化 → 验证修复 → 提炼经验 → 独立复核」。通过来源验证的经验会标明来源；后续适用任务显示参考记录。来源验证不证明未来任务收益。

查看经验的处理策略、条件和使用记录；你可以反馈“不相关”或“策略错误”、修订、停用或恢复。不要为了让状态变绿而填写虚假的“通过验收”。显式 `evolve_` 工具仍兼容，适合手动排查和受控案例。

## 5. 从旧本地预览升级

本节只针对本项目**尚未公开的旧本地包**，不针对其他同名开源项目。

1. 停止原 DSH 和独立面板，确认没有后台任务正在执行。
2. 备份 profile、配置和整个 dataDir（包括 SQLite 和私有快照）。保留预算、提炼 grant 和未知记录。
3. 在原 profile 先移除旧本地插件依赖，再安装新包：

   ```sh
   dsh plugin --profile web remove dsh-evolve
   dsh plugin --profile web add dsh-reforge@0.1.0-alpha.1
   ```

4. 使用原配置和 dataDir 重启。旧环境变量仍可用。检查经验、来源、版本和使用次数保持。

已发布的 `0.1.0-alpha.1` 保留当时的内部 patch 行 ID 和 RPC；当前未重新发布的源码已统一为 `dsh-reforge`，具体升级见下一节。`evolve_` 工具和 SQLite v9 保持兼容。默认数据位置仍为 `~/.dsh/evolve/<repoId>/evolve.sqlite`，无需搬迁。不要同时运行新旧插件，不要从 registry 安装第三方 `dsh-evolve`，也不要通过降级程序直接打开新数据库。恢复程序版本与回滚用户代码是不同操作。

## 6. 从首发包升级到当前源码

本节适用于 T038 后的开发源码，不表示 npm 首发包已经更新。先停止所有旧服务和面板，确认没有后台学习任务；备份 profile、原配置、SQLite 及私有快照。

在原 profile 移除旧插件依赖，再安装经过检查的新 tgz；沿用原配置的绝对路径和同一 dataDir。若 profile 的自定义 patch 曾使用 `id: dsh-evolve` 覆盖配置，只把该行改为 `id: dsh-reforge`，保持整份 config（包括 dataDir、grantId、maxCalls）不变。不要新增第二份行或同时启用新旧 ID；若存在多行，停机核对后再启动。默认数据路径和 SQLite 文件名不变，无需搬迁。

启动新服务时重新打开本机生成的认证入口，刷新网页使客户端和服务端同时更新。当前源码使用新的原生 RPC 路径，旧页面不能跨版本混用。旧消息来源仍可读，旧配置变量仍兼容，用量指纹域保持原字节。

启动前后核对 schema v9、经验、应用、反馈、预算账本、未知费用占额及已使用次数完全一致；若不一致，停机排查，勿重置或重放。项目更名不授予额外次数。当前实际体验环境仍使用冻结首发包，本次仓库更名不自动替换它。

首发 npm 包和 Release 附件的原仓库元数据、SHA256 与注释 tag 是历史事实，不能改写；当前源码包使用新地址。任何后续公开发行需要新版本和单独授权。

## 排查

- 找不到入口：确认启动 DSH 的 profile 与安装 profile 相同，版本为0.2.0-rc.2，且安装后已重启。
- 页面要求认证：重开 `dsh web` 打印的完整地址。
- 模式关闭/次数不足：按页面原因检查本机配置；Agent和面板不能替你开启共享或增加次数。
- Windows权限错误：按 DSH 官方诊断流程，仅对明确授权目录修复；本插件不扩大系统权限。
- 需要独立面板：运行 `dsh-reforge panel --config <配置文件>`，私密地址只在本机终端显示。它不能代替 DSH 提供后台提炼模型。

有问题请在 [Issues](https://github.com/wang1299/dsh-reforge/issues) 提供版本、脱敏最小复现和错误类别；不要上传聊天、Key、完整配置、认证地址或经验数据库。
