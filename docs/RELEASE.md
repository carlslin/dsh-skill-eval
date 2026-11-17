# Release checklist · 发布检查表

## 1. 代码与文案

- [ ] `npm run build` 全绿（format check、lint、client build、doctor、**272 tests**）
- [ ] `npm run build:pack` 产出 tarball 并通过 `doctor --release`
- [ ] `package.json` version 与 `client.js` 的 `DATA_VERSION` 一致（doctor 检查）
- [ ] CHANGELOG 有本次版本条目
- [ ] README / README.zh 的入口描述与 `docs/ENTRYPOINTS.md` 一致

## 2. 真实宿主验证

- [ ] `dsh-skill-eval-accept` PASS（17 项，含看板、配置页、回合快照、设置读写）
- [ ] `dsh-skill-eval-verify` PASS（7 项 + 2 项手动，确认宿主真的服务这一代代码）
- [ ] 打开侧边栏「技能评测」面板：五个标签（技能/轨迹/运行/MCP/开发者）、刷新、复制
- [ ] 设置 → 插件 → `dsh-skill-eval` → 配置：改一个值 → 保存 → 看到「已保存并立即生效」
- [ ] 在同一轮加载多个 skill：回合条显示每个 skill 的 chip 与各自 next fix

## 3. 打包

```bash
npm run build:pack   # format/lint/client/doctor/tests + dist/<version>.tgz + doctor --release
npm publish --dry-run 2>&1 | tail -20   # confirm no bin warnings and note files/size
```

- [ ] `docs/ui/*.png` 不在 tarball 里（约 4 MB 的截图不应发布）
- [ ] LICENSE、README、README.zh、CHANGELOG、docs/*.md 在 tarball 里

## 4. 干净 profile 冒烟（安装产物，而不是源码目录）

```bash
dsh plugin --profile sevsmoke add "$PWD/dist/dsh-skill-eval-<version>.tgz"
# 启动该 profile 的 web 宿主，拿到端口后：
node scripts/accept.mjs http://127.0.0.1:<port>
node scripts/verify-live.mjs http://127.0.0.1:<port>
# 清理
dsh plugin --profile sevsmoke remove dsh-skill-eval
```

## 5. 已知遗留（不阻塞发布）

- 插件详情页展示英文 `README.md`；看板里的建议正文为英文（规则输出），中文界面下中英混排。
- 原生配置页在 README 之后，需向下滚动。
- 已安装插件列表无搜索（平台行为）。
