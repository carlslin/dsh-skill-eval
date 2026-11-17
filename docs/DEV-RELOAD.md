# 开发模式与热重载（给改插件的人看）

这份文档解决一个反复踩的坑：**改了插件代码，界面上却看不到**。

## 为什么改了没生效

DSH 的插件在启动时作为 ES module 加载。之后：

- **disable / enable 只会重跑 `apply`，不会重新 import 文件**——模块实例仍在 ESM 缓存里
- 因此 `PLUGIN_VERSION`、路由注册表、客户端模块清单都停留在启动那一刻
- 客户端（`client.js`）更严格：模块清单来自 boot 扫描，**刷新页面也不重新扫描**

所以判断"是不是新代次"，不要看文件 mtime，要探测**只有新一代才有的路由**：

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://127.0.0.1:<port>/skill-eval/data/<当前版本>
# application/json  → 宿主就是这一代
# text/html         → 命中旧前缀兜底路由，宿主还是旧代次
```

`dsh-skill-eval-accept` 的 `versioned-route` 与 `settings-api` 两项就是在做这件事。
更快的办法是在对话里跑 `/skill-eval dev`：它会直接对比**已加载模块版本**与
**磁盘 package.json 版本**，不一致就给出 `module-skew` 与重启提示。

## 让热重载真正生效（已在本机验证）

根因：插件模块是 ES module，禁用/启用只会重跑 `apply`，不会重新 `import` 文件；
只有当 **Cordis HMR 监视到源文件变化**时，它才会让 loader 重新导入该模块。

启用监视（一次性，写入 profile patch）：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    root:
      - /Users/adams/Documents/dsh-plugins/dsh-skill-eval
    ignored:
      - '**/node_modules/**'
      - '**/.git/**'
      - '**/dist/**'
      - 'cache'
      - 'data'
```

之后每次改完源码：

```bash
touch index.js lib/*.js client.js        # 或任何真实改动
sleep 3                                  # HMR 默认 debounce + awaitWriteFinish
curl -s -o /dev/null -w '%{content_type}\n' \
  http://127.0.0.1:<port>/skill-eval/data/<新版本>
# application/json → 新代次已生效（改版本号时用新版本号探；不改版本用旧版本号）
```

实测：1.15.2 → 1.15.3 → 1.15.4 都靠 HMR 完成，没有重启；客户端半个由
client HMR receiver 替换已构建的 bundle（改的是 `client/*.js`，先
`node scripts/build-client.mjs` 再 `touch client.js`；未替换时刷新一次页面）。

注意两点：

- **canonical 路由可能仍由旧实例应答**（`/skill-eval/data`、`/skill-eval/settings`）。
  热重载后请用**版本化路由**（`/data/<version>`、`/settings/<version>`）做判断，
  客户端和 verify 脚本用的都是版本化路由。
- profile patch 改动本身也会被 HMR 监视并重排，所以启用监视不需要重启；
  但把 patch 写坏会导致下次启动失败，改前先备份（本仓库操作时已生成
  `cordis.patch.yml.bak-skill-eval-<时间>`）。

## 什么时候必须重启

| 改了什么                                | 生效方式                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `index.js` / `lib/*`（host 半）         | 正常情况：重启；极少数情况下 disable/enable 会重新 import，不要依赖        |
| `client/*.js`（client 源）              | `node scripts/build-client.mjs` → `touch client.js`，HMR 替换已构建 bundle |
| `client.js`（生成产物）                 | 不要手改；由 `client/*.js` 构建，doctor 检查两者一致                       |
| `package.json` 版本号                   | 重启（版本化路由前缀由模块加载时的版本决定）                               |
| 数据文件（events.jsonl、settings.json） | 立即（每次请求重新读）                                                     |
| 由 `settings.json` 覆盖的配置           | 立即（保存即改内存中的 cfg）                                               |

## 给调试用的开关

| 开关                                 | 作用                                                |
| ------------------------------------ | --------------------------------------------------- |
| `window.__SEV_ENABLE_POPUP__ = true` | 恢复侧边栏弹窗模态框（默认只有常驻按钮打开看板）    |
| `DSH_SKILL_EVAL_DEBUG=1`             | host 侧把警告同时写 stderr                          |
| `DSH_SKILL_EVAL_DIR=<path>`          | 覆盖数据目录（隔离实验数据）                        |
| `DSH_SKILL_EVAL_BASE=<path>`         | 验收脚本使用的看板路径前缀（默认 `/skill-eval`）    |
| `DSH_SKILL_EVAL_VERSION=<v>`         | 验收脚本探测的版本化路由版本（默认取 package.json） |

## 客户端与旧宿主兼容

新客户端必须能跑在旧宿主返回的数据上（1.10.x 没有 `edits` / `validity`）。测试用
`test/fixtures/live-1.10.1.json`（真实宿主抓下来的载荷）锁定这一点；原生设置页在
旧宿主上会显示"重启 DeepSeek Harness 后可用"并给出网页配置页链接，而不是白屏。

## 一个可复制的验证流程

```bash
dsh-skill-eval-verify                     # 重启后一键验证产品面（10 项）
dsh-skill-eval-accept                     # 探当前代次（端口自动发现）
curl -s http://127.0.0.1:<port>/skill-eval/data | head -c 200
# host 需重启时会出现：/data/<new-version> 返回 text/html

# 想在不动 GUI 进程的前提下验证 host 代码：起一个一次性 profile
dsh sevcheck --from-default-profile web --help
dsh plugin --profile sevcheck add "$PWD"
dsh --profile sevcheck --no-open --port 59231 &
node scripts/accept.mjs http://127.0.0.1:59231
kill %1 && rm -rf ~/.dsh/profiles/sevcheck
```

这条流程在 1.12.0/1.12.1 上实际用过：17 项 PASS，设置 API 的保存/归一化/400 都验证过。
