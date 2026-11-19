# 入口 · Entry points

三个常用入口，其余都是给 agent / 终端 / 调试用的。日常只需要记住前三行。
Three everyday entry points; everything else is for agents, terminals or debugging.

## 日常 · Everyday

| 要做什么 · Goal | 中文入口 · Chinese                                 | English entry                                                         | 说明 · Notes                                                        |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 看这一轮的结果  | 每个完成回合下方的**结果条**                       | the **result strip** under a completed turn                           | 分数、调用/报错、下一步修复、改动记录；点「本轮详情」展开           |
| 打开看板        | 侧边栏底部的**面板图标「技能评测」** → 主面板      | the **panel icon "Skill eval"** in the sidebar → main panel           | 与「上下文」插件同位置；面板内含 技能/轨迹/运行/MCP/开发者 五个标签 |
| 改评分标准      | **设置 → 插件 → `dsh-skill-eval` 的包页面 → 配置** | **Settings → Plugins → the `dsh-skill-eval` bundle page → Configure** | 与上下文插件同一位置（bundle config）；权重、阈值、预算等保存即生效 |

## 网页 · Web

| 用途 · Purpose                            | 地址 · URL                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| 汇报看板 · Board                          | `http://127.0.0.1:<当前端口>/skill-eval`（热重载期间用 `/skill-eval/board/<版本>`） |
| 网页配置页（与设置页同源） · Web settings | `…/skill-eval/config`                                                               |
| JSON 数据 · JSON report                   | `…/skill-eval/data/<version>`                                                       |

端口每次启动会变；`dsh-skill-eval-verify` 会自动发现。Port changes per launch; the verify script discovers it.

看板与设置页支持中英双语：按浏览器 `Accept-Language` 自动选择，也可用 `?lang=zh|en` 强转；页面右上角有切换链接。建议正文（advice）目前仍是引擎输出的英文。

The board and settings page are bilingual: `Accept-Language` picks the language, `?lang=zh|en` overrides it, and a toggle link is on the page. Rule-generated advice text stays English for now.

## 对话内 · In chat

| 命令 · Command                                          | 作用 · What                                 |
| ------------------------------------------------------- | ------------------------------------------- |
| `/skill-eval`                                           | 总览 · cross-skill summary                  |
| `/skill-eval <skill>`                                   | 单个技能 · one skill                        |
| `/skill-eval loop [all]`                                | 下一步改什么 · next optimization step       |
| `/skill-eval validity`                                  | 证据能支持什么 · what the evidence supports |
| `/skill-eval history <skill>` / `impact <skill>`        | 趋势 / 改动前后 · trend / edit impact       |
| `/skill-eval mcp` / `runs` / `turns` / `dev` / `config` | MCP / 运行 / 每次执行的板 / 诊断 / 生效配置 |

## 给 agent · For agents

| 工具 · Tool         | 作用 · What                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| `skill_eval_report` | 同一份报告（`view` 可选 summary/mcp/runs/loop/validity/history/impact/turns/dev） |
| `skill_eval_review` | 改技能前做泄漏审查并写 ledger · leak screen before editing a skill                |

## 终端 · Terminal

```bash
dsh-skill-eval-doctor    # 打包预检 19 项（非 --release；--release 加产物检查）· packaging pre-flight
dsh-skill-eval-accept    # 代次/数据契约 17 项 · generation & data contract
dsh-skill-eval-verify    # 产品面可达 7 项 + 2 项手动 · product surfaces (after a reload)
```

## 调试（可选） · Debug (opt-in)

| 开关 · Switch                                 | 作用 · What                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| 页面里设 `window.__SEV_ENABLE_POPUP__ = true` | 弹窗 + 侧边栏按钮回来 · popup + sidebar button return                  |
| `/skill-eval dev`                             | 代次漂移、存储健康、已注册路由 · generation skew, store health, routes |

## 刻意不做的入口 · Deliberately removed

- 插件详情页里再放一个区块（与看板重复）· a second section on the plugin detail page
- 侧边栏常驻按钮（默认不注册，避免和面板图标重复）· an always-on sidebar button
- 「更多」菜单里的看板行（看板已升为侧边栏主面板）· the More-menu board row (the board is now a main panel)
