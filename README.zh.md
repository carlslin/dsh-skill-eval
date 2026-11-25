# dsh-skill-eval（技能评测）

[![npm](https://img.shields.io/badge/npm-v1.24.0-cb3837)](https://www.npmjs.com/package/dsh-skill-eval)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![release](https://img.shields.io/badge/release-v1.24.0-blue)](https://github.com/carlslin/dsh-skill-eval/releases)

技能没有成绩单。这个插件替它记一份。

每次技能被加载，它都会顺手记下之后发生了什么：加载有没有成功、后面的工具调用有没有
报错、结果有没有被你推翻、技能有没有被忽略、有没有和别的技能撞车、花了多少。跑过
几次之后，每个技能会拿到一个 0–100 的分数，和一份具体到怎么改的清单。

它作为 DeepSeek Harness（DSH）插件运行。这点很关键：大多数技能检查工具看的是技能
_文件_，而上面这些信号只有在 harness 真跑起来时才存在。

第一次用：装上它（`dsh plugin --profile desktop add dsh-skill-eval`），随便用一个技能，
然后看那一回合下面的结果条。

## English at a glance

- Telemetry after every skill load; 0–100 scores with 95% bootstrap intervals.
- Three human entry points: the per-turn result strip, the sidebar **Skill eval**
  board panel, and **Settings → Plugins → `dsh-skill-eval`**.
- Rule-based advice with measured evidence, localized into Chinese in the
  Chinese UI. Full English docs: [README.md](README.md).

## 产出

- **对话内结果条**：每个用过技能的完成回合下面一行，显示分数、本轮调用与报错、
  可展开的修复清单（零 token，不弹窗）。旧弹窗保留但需手动开启
  （`window.__SEV_ENABLE_POPUP__ = true`）。
- `skill_eval_report` 工具 —— agent 直接读自己的遥测，不再靠猜
- `/skill-eval [技能]` 命令 —— 在输入框里看同一份报告
- `/skill-eval/board/<版本>` —— 看板：等级、维度条、趋势，以及每个技能接下来该改什么
- 追加式 JSONL 遥测：`$DSH_HOME/skill-eval/$DSH_PROFILE/events.jsonl`
  （上限 8 MB，写满后丢弃最旧的一半，长期运行也不会无限增长）
- **技能卡「复制问题」**：把该卡当前的评分、维度、证据和全部问题复制成可直接粘贴的
  Markdown 修复任务；单条建议仍保留「复制此问题」。

## 截图

| 技能看板                              | MCP 标签                                  | 评分配置                                      |
| ------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| ![技能看板](docs/ui/board-skills.png) | ![MCP 标签](docs/ui/board-mcp-1.20.2.png) | ![评分配置](docs/ui/config-dialog-1.20.2.png) |

更多真实窗口截图与逐屏记录：[docs/UI-REVIEW.md](docs/UI-REVIEW.md)。

## 分数由什么组成

| 维度     | 权重 | 信号                                                         |
| -------- | ---- | ------------------------------------------------------------ |
| 静态质量 | 0.30 | 描述、触发线索、渐进披露、体量、示例                         |
| 可靠性   | 0.25 | 加载成功率 × 加载后工具错误率                                |
| 有效性   | 0.30 | 显式评分、用户纠正、加载后被忽略、兄弟技能碰撞、产出的交付物 |
| 效率     | 0.15 | 每次运行的调用数、加载延迟、上下文压缩                       |

证据来自 DSH 的耐久事件流：`feedback/message-put`（显式评分）、`deliverables/presented`、
`workspace/changes`、`job/settled`、`team/task`、`approval/asked|decided`、
`compaction/start`、`model/selection` 与 `agent-preset/selected`。静态检查评的是
模型目录里渲染后的描述（归一化并截断），不是原始 frontmatter。

等级：`A ≥ 90`、`B ≥ 80`、`C ≥ 70`、`D ≥ 60`、`F < 60`。

### 分数怎么读

分数是摘要，不是判决书。每个分数都带 95% 区间：两个技能的区间一旦重叠，看板会直接
标“排名不显著”。加载次数少于 `minSamples`（默认 3）的技能标为暂定，不给强结论。
某个维度没有证据时会被丢掉、剩余权重重新分配，而不是按 0 分算。完整规则和公式在
[docs/DETAIL.md](docs/DETAIL.md)。

建议不是套话：每条都带触发它的数字和具体改法；中文界面下标题和修复都是中文。

## 入口

日常只用三个地方：

| 目标         | 位置                                                           |
| ------------ | -------------------------------------------------------------- |
| 看本回合结果 | 完成回合下方的结果条（分数、调用/报错、下一处修复、改动记录）  |
| 打开看板     | 侧边栏 **「技能评测」** 面板图标（主面板，与上下文插件同位置） |
| 改评分标准   | **设置 → 插件 → `dsh-skill-eval` 包页面 → 配置**               |

网页版看板：`/skill-eval/board/<版本>` · 网页配置：`…/config` · JSON：
`…/data/<版本>`。对话命令、agent 工具、终端检查与调试开关见
[docs/ENTRYPOINTS.md](docs/ENTRYPOINTS.md)。

```bash
dsh-skill-eval-doctor   # 打包预检（--release 为发布门禁）
dsh-skill-eval-accept   # 数据契约与生成检查（17 项）
dsh-skill-eval-verify   # 产品面可达（7 项 + 2 项手动，重载后）
```

## 安装

要求：带插件 bundle 能力的 DeepSeek Harness（包内声明 `dsh.engines.dsh >= 0.2.0`），
CLI 辅助脚本需要 Node.js ≥ 20。

从 npm 安装：

```bash
dsh plugin --profile desktop add dsh-skill-eval
```

从 GitHub 源码安装。克隆下来只有 `src/`。`index.js`、`lib/`、`scripts/`、
`client.js` 都是构建产物，宿主加载的是这些文件。先打包再安装 tarball。不要把
`dsh plugin add` 或 `plugin_manager` → `install_bundle` 指到 git 检出目录。

```bash
git clone https://github.com/carlslin/dsh-skill-eval.git
cd dsh-skill-eval
npm install          # prepare 会编译出运行时文件
npm pack             # 打的是这些文件，不是 git 树
dsh plugin --profile desktop add "$PWD"/dsh-skill-eval-*.tgz
```

从发布 tarball 安装（发布产物）：

```
dsh plugin --profile desktop add "$PWD/dist/dsh-skill-eval-<版本>.tgz"
```

npm 包和发布 tarball 是预构建的。git 检出目录不是。修改 `src/client/*.ts` 后要跑
`npm run build:client`，它用 `typescript` 这个 devDependency 去掉类型并写出
`client.js`。装完刷新 GUI：看板是侧边栏的
「技能评测」面板，配置在 **设置 → 插件 → `dsh-skill-eval`**。

## 用法

- **结果条**：完成回合下方，分数、调用/报错、下一处修复、改动记录（零 token）。
- **看板**：技能 / 轨迹 / 运行 / MCP / 开发者标签，含下一步、效度摘要与 SVG 图表；「轨迹」逐步打分并对比最近几个回合。每张技能卡在「查看轨迹」旁有「复制问题」，可把该卡当前的问题、评分、维度与证据复制成一段独立的 Markdown 修复任务；每条建议仍可单独复制。
- **让 agent 看**：直接问「`pdf-tools` 表现怎么样」—— agent 会调 `skill_eval_report`；
  改技能前它被告知先调 `skill_eval_review` 做泄漏审查。
- **对话命令**：`/skill-eval`、`/skill-eval <技能>`、`loop [all]`、`validity`、
  `history`、`impact`、`mcp`、`runs`、`turns`、`dev`、`config`、`accept`。
- **只读 Inspect**：provider `skill-eval`，方法 `summary|skill|mcp|runs|edits|standard`。
- **怎么改技能**：只处理 `critical`/`warning`，照 `fix` 改，再用几轮真实加载重测。

## 配置

配置在包页面的原生表单里；也可以用 config 或 `settings.json` 预置。常用项：

```yaml
enabled: true
windowToolCalls: 12 # 一次加载的证据窗口内工具调用数（立即生效）
minSamples: 3 # 样本达到多少后分数不再算临时值
weights: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 }
thresholds: { excellent: 90, good: 80, pass: 70 }
tokenBudgetPerLoad: 20000 # 单次加载可计费 token 预算（并行窗口按 1/N 分摊）
adviceNoiseFloor: true # 建议必须越过 95% 区间才保持 critical
redactCorrections: false # true = 用户纠正只存脱敏占位符
turnReports: true # 每个结算回合写一份看板到 reports/turns/
turnReportsKeep: 50 # 保留多少块按回合看板
reportOnTurnEnd: true # 每回合写 latest.md + latest.json
# snapshots: { latest: true, turns: true, keep: 50 } # 三件套可写成一个对象
promptHint: true # 系统提示里一行提示；false = 零固定成本
registerReviewTool: true # skill_eval_review：泄漏审查 + 审计账本
```

全部 31 项（含剪枝、编辑预算、缓存权重、MCP 工具阈值、面板路径、快照三件套）：
[docs/DETAIL.md](docs/DETAIL.md#configuration-keys)。`DSH_SKILL_EVAL_DIR` 可覆盖数据目录，
默认 `$DSH_HOME/skill-eval/$DSH_PROFILE`。数据/设置 JSON 常驻标准 `/skill-eval` 基址，
自定义 `dashboardPath` 下也会镜像一份，热重载后看板不断连。

## 测试

```
npm test
```

`npm test` 会先编译，再对着 `src/` 跑套件（不是上一份 `lib/*.js`）。测试命令是
`node --experimental-strip-types --test "test/**/*.test.ts"`；Node 22/24 会把裸目录当成
入口模块，必须显式 glob。评分分档、静态检查、纠正识别、窗口生命周期（回合结束快照 →
纠正 → 关闭）、带残缺行的存储往返、分析器 join、Markdown/HTML 渲染（含转义与中文
建议文案）、重复路由压力下的宿主路由注册，以及客户端的 jsdom 挂载测试。

## 反馈

问题和建议走 GitHub Issues：<https://github.com/carlslin/dsh-skill-eval/issues>。
请附插件版本（`dsh plugin list`）、DSH 版本与 profile、看板前后对比和复现步骤；
看板技能卡上的「复制问题」能生成可直接粘贴的 Markdown 报告。

遥测不出本机：记录在 `$DSH_HOME/skill-eval/$DSH_PROFILE/events.jsonl`；
`redactCorrections: true` 时用户纠正文本只存 `[redacted N chars]`。
贴片段前先看 [docs/DETAIL.md](docs/DETAIL.md) 的记录 schema。

## 更多文档

- [docs/AUDIT.md](docs/AUDIT.md) —— 多层审计：问题、修复与遗留
- [docs/CODE-REVIEW.md](docs/CODE-REVIEW.md) —— 代码卫生：死代码、重复实现与清理
- [docs/UI-REVIEW.md](docs/UI-REVIEW.md) —— 真实窗口逐屏记录 + 截图（`docs/ui/`）
- [docs/ENTRYPOINTS.md](docs/ENTRYPOINTS.md) —— 全部入口、命令与调试开关
- [docs/WORKFLOW.md](docs/WORKFLOW.md) —— 加载 → 测量 → 区间评分 → 建议 → 审查改动 → 重测
- [docs/DETAIL.md](docs/DETAIL.md) —— 评分规则、记录 schema、完整配置项
- [docs/RELEASE.md](docs/RELEASE.md) —— 发布检查表与干净 profile 冒烟
- [docs/COMPARISON.md](docs/COMPARISON.md) —— 公开实现对比
- [docs/DEV-RELOAD.md](docs/DEV-RELOAD.md) —— 热重载与一次性 profile 验证
- [CHANGELOG.md](CHANGELOG.md) —— 版本历史

## 已知盲区

- 记录 `skill` 工具调用与用户输入的 `/skill-name`；harness 自动激活、既不调工具也不输命令的技能看不到。
- 有显式评分时以评分为准；没有评分才回退到下一条用户消息。产出证据只认交付物、文件改动、后台任务完成与团队任务完成。
- 子代理/团队窗口带 `agentKind`/`agentName` 记录，但仍合并进同一个技能分数。
- 静态检查用渲染后的目录描述；未捕获到真实目录消息时按宿主的默认上限（500 字符）重建。
- 中文界面下建议的 evidence 仍保留测量用的英文 id/数字。
- 遥测只追加；上限 8 MB，写满后保留最新一半（`edit` 审计账本优先保留）。
- 用户纠正文本与显式反馈备注默认保存；设 `redactCorrections: true` 后只存 `[redacted N 字符]`。
