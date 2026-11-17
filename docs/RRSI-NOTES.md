# RRSI 调研笔记（Google Cloud AI Research）

> 调研时间：2026-11-15。用途：给 `dsh-skill-eval` 找"用评测信号驱动技能优化"的可借鉴机制。
> 证据状态：**一手资料** = 论文摘要页、GitHub README、项目页；**未读到** = 论文 3.3 省选公式细节、附录 D、Limitations 章、逐 benchmark 结果表（HTML 抓取被截断在 50k 字符）。文中凡未核实处均已标注。

## 1. 是什么

**RRSI = Regularized Recursive Self-Improvement of Agent Harnesses**

- 论文：arXiv:2609.24972（Peng Xia 等 14 人，Google Cloud AI Research + Stanford / WashU / UNC；2026-09-21 首版，2026-10-04 v3）
- 代码：<https://github.com/google-research/rrsi>（Apache 2.0；README 明确声明**不是** Google 官方支持产品）
- 项目页：<https://regularized-rsi.com/>

一句话：**不限制 harness 能改什么，而是正则化"改"这个搜索过程本身**，让 agent 的脚手架自我改进时不要把评测集的特性、噪声和复杂度一起学进去。

## 2. 要解决的问题：harness 自我进化的 adaptive overfitting

前提：模型权重冻结，agent 能力主要由 **harness** 决定——system/task prompt、控制流（何时规划/行动/反思/停止）、工具接口与描述、memory 与 skill 文件、上下文管理。

现有做法：用 LLM 反复提议候选 harness，在同一组 evolve 集上评估、取最优 → agent 系统层的递归自我改进（RSI）。

失效模式（论文明确列出三种，且相互耦合）：

| 失效                           | 含义                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| **benchmark-specific fitting** | 把评测集特有模式写进 harness（任务名、实体、答案、只对该套件成立的逻辑） |
| **noise chasing**              | 把有限次运行的评估噪声当收益，选进了"运气好"的候选                       |
| **complexity accumulation**    | 复杂化本身在涨分，但没有换来可复用机制                                   |

后果：evolve 集收益很大，OOD 上缩水甚至归零；论文称部分 baseline 最终**还不如初始 harness H0**。

## 3. 形式化

agent `A = (π, H)`：π 冻结策略，H 是 harness。任务 x 产生轨迹 τ 与交付物，verifier 打分 `r(x,τ) ∈ [0,1]`（单测或 LLM judge）。

- 任务性能 `S(H;D) = E_x E_τ[r(x,τ)]`
- 成本 `C(H;D) = E_x E_τ[c(τ)]`，`c(τ)` = 轨迹消耗的 policy token 数

第 t 轮：从 `H_t` 提议候选集 `H_t = {H_t^(1)…} ~ P0(·|H_t, F_t)`，在 evolve 集上用 k 次试验估 `Ŝ`、`Ĉ`，取 `argmax S`。关键点：**同一个 evolve 集被反复自适应使用**，所以这是"在表达力极强的空间里做自适应经验优化"，噪声与泄漏天然会被利用。

## 4. 方法：提议侧 + 省选侧

### 4.1 提议侧（控制搜索容量怎么花）

**L0 式退火编辑预算**：一个候选最多打包多少个"可独立归因的编辑"，随轮次余弦退火：

```
b_t = ⌈ b_min + (b_max − b_min) · ½(1 + cos(π t / T)) ⌉
```

早期允许多处协同改动以发现新机制，后期逐步收紧到"一次一个可归因改动"。

**证据感知的信用分配**：每次评估写入 ledger（组件、假设、diff、分数变化、成本变化、裁决）。提议者读完整历史，**不重复重测已被证伪的假设**——避免把预算反复花在同一张牌上（adaptive data reuse 的经典问题）。

**结构化探索**：当进展停滞在噪声带内，把预算转向本轮**完全没碰过**的组件。

> 论文自己说明这三者是**类比**：编辑预算≈L0 基数约束、剪枝≈Lasso/L1 稀疏、复杂度感知接受≈Ridge/L2 收缩，并不是真在优化带惩罚项的目标函数。

### 4.2 省选侧（哪些收益允许成为永久状态）

| 机制                               | 做法                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **泄漏审查 critic**                | 候选**在打分之前**先筛：任务名/实体/答案/评测集特有逻辑一律拒（domain 正则 denylist + LLM review，允许有界修复）                                |
| **噪声调整地板**                   | 增益必须超过"未改动基线 harness 上测出的方差"，否则不接收；每个 instance 的噪声带固定（0.017 / 0.004 / 0.020），可用 `rrsi/calibrate.py` 重标定 |
| **成本规则**                       | 新增推理 token 必须由测得的增益**付账**，否则拒                                                                                                 |
| **剪枝**                           | 不再赚钱的组件被标记删除；剪枝集合交给提议者去删                                                                                                |
| **novelty / within-band / argmax** | 结构新颖度（K_str = `client_tool`、`skill`、`memory`、`subagent` 四类组件中从未出现在获胜编辑里的）参与选择                                     |

### 4.3 工程实现（README 的 "Method to code" 表）

- 候选在**独立 git worktree** 里起草/筛查/评估，分支从 `evolve/<domain>` 拉出；接受即 fast-forward → **incumbent 永远是一个 commit**，可审计
- 同一套循环接三个 `Domain` 适配器：终端 agent（Terminal-Bench 2.1）、文档工作 agent（Harvey LAB）、工程设计 agent（EngDesign）
- 关键代码位置：`rrsi/schedule.py: edit_budget`、`rrsi/history.py: History/stall_flag/exploration`、`rrsi/critic.py`、`rrsi/selection.py`、`rrsi/components.py: novelty`、`rrsi/evaluate.py: aggregate`（缺 trial 按 0 计且分母不缩水）
- 结果可审计：ledger 每行一条编辑；proposer/analyst/critic 收到的 prompt 都是 `domains/<name>/` 下的纯文本文件

## 5. 结果（摘要 + 项目页口径）

- 8 个 benchmark / 3 个领域；每个领域只在一个 suite 上进化，其余**原封不动**跑
- evolve 集最多 **+6.0**；**5 个 OOD benchmark 全部提升**，最多 **+4.3**
- 最终 harness 比无正则化演化少用 **30% policy token**
- 论文 intro：OOD 上比"四个 baseline 的平均"最多高 **12.5%**；项目页写"比 prior average 最多高 **22.9%**"
  ⚠️ **两个来源数字不一致**，引用建议以论文结果表为准（本次未读到表格，未能核对）
- policy 固定为 Claude Opus 4.8（项目页）；judge 口径：coding 用 pass rate，Harvey LAB / JobBench / APEX-Agents 用模型判分 rubric，GDPval 用对真人专家的胜率，EngDesign / Frontier-Eng 用冻结模拟器

## 6. 对 dsh-skill-eval 的意义

RRSI 的整个循环只需要两样东西：**可靠的任务级分数 S** 与**成本 C**（policy token）。RRSI 的可编辑组件里明确包含 **skill**（K_str 之一）。我们的插件产的正是**单 agent 运行时、按技能归因的 S 与 C 信号**——所以关系是：

> RRSI 是"消费者/优化器"，`dsh-skill-eval` 是"传感器"。

### 6.1 机制对照与 backlog

| RRSI 机制       | 我们现在                                                                                                                                               | 建议落地  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 噪声调整地板    | ✅ 已有 CI + `ranking.significant=false`；**1.2.0 起建议层也接上了**（rate bootstrap，CI 未越过阈值的规则降为 info 并标注 "not outside noise yet"）    | ✅ 已完成 |
| 成本规则        | ✅ **1.2.0 起有真实 token**：`assistant/message.usage` 归因到窗口 → `tokensPerLoad`（cacheRead 按权重折算），进效率维度 + `token-cost` 建议 + 运行看板 | ✅ 已完成 |
| 泄漏审查 critic | ✅ **1.3.0**：`skill_eval_review` 工具 + `lib/critic.js`，拒/警/受三类裁决（写死答案、benchmark 名、task id 直接 reject）                              | ✅ 已完成 |
| 证据 ledger     | ✅ **1.3.0**：每次 review 落 `{t:'edit', skill, hypothesis, verdict, reasons, diffHash}`，报告/inspect 的 `edits` 可读                                 | ✅ 已完成 |
| 剪枝            | ✅ **1.3.0**：`prune-candidate` 规则（≥6 次加载、分数 <60 且区间整体偏低 → critical）                                                                  | ✅ 已完成 |
| 退火编辑预算    | ✅ **1.4.0**：`adviceBudget` 按已接受编辑数余弦退火（4→1），限制每轮可行动的修复条数                                                                   | ✅ 已完成 |
| novelty 探索    | ✅ **1.4.0**：ledger 记录编辑维度；连续 2 次同维度 → `exploration` 指令指向最久未动的维度                                                              | ✅ 已完成 |

### 6.2 一个闭环形态（= RRSI 的循环换掉数据集）

`/skill-eval loop`（1.5.0）：读建议 → 按退火预算选 ≤N 条 → 必须先过 `skill_eval_review` 泄漏审查 → 应用 → 重测下一轮；**只有「CI 外正收益 且 token 不变差」才保留**。等价于 RRSI 的循环，只是把 benchmark 集换成真实会话窗口。

这同时补掉我们之前的效度短板：不靠人工判断，而靠"改动前后区间是否分离"来判定技能是否真的变好。RRSI 用 benchmark 集做这件事，我们用真实会话的 skill 加载窗口做。

## 7. 未核实清单（避免过度引用）

- 论文 3.3 节省选的具体公式（噪声地板的精确判据、cost rule 的数学形式、within-band 规则、argmax 组合方式）
- 附录 D 算法细节、Limitations 章、搜索本身的算力/API 预算（跑了多少轮、多少花费）
- 逐 benchmark 结果表；"12.5% vs 22.9%" 差异原因
- 三个领域各自起始 harness 的内容与大小

## 8. 引用

```bibtex
@article{xia2026rrsi,
  title={RRSI: Regularized Recursive Self-Improvement of Agent Harnesses},
  author={Xia, Peng and Han, Rujun and Wang, Zifeng and Chen, Yanfei and Zhuang, Yufan and Lee, Yoonho and Huang, Chengsong and Yu, Han and CuiZhu, Zhongying and Ming, Yifei and Yao, Huaxiu and Gokturk, Burak and Pfister, Tomas and Lee, Chen-Yu},
  journal={arXiv preprint arXiv:2609.24972},
  year={2026}
}
```

- 论文：<https://arxiv.org/abs/2609.24972>
- 代码：<https://github.com/google-research/rrsi>
- 项目页：<https://regularized-rsi.com/>
