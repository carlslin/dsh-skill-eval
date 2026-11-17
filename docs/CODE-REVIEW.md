# 代码卫生审查 · Code hygiene review (1.20.0 + unreleased follow-up)

范围：`index.js`、`client/*.js`、`lib/*.js`、`scripts/*.mjs`、`test/`、`package.json`、
`docs/`。方法：静态扫描（未使用导出/导入、死 CSS、TEXTS 键使用）、重复实现比对、
覆盖率地图、打包清单核对，然后运行 239 项测试与线上验收。

## 已清理

| #   | 类别       | 发现                                                                                                                                                                                                            | 处理                                                                                                                                                                                                       |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 元数据资源 | `locale/{en,zh}.json` 不是死文件：DSH 从 `locale/<lang>.json` 读 `meta.title`/`meta.description` 做插件市场与详情页本地化（删除后中文描述会回退英文）。旧文件里另有 16 个未被任何代码引用的 UI 键，属于漂移残留 | 恢复目录，**只保留 `meta.title`/`meta.description`**；恢复 `exports`/`files`；doctor 改为检查两份 meta 非空；插件列表重新显示中文描述                                                                      |
| 2   | 重复实现   | `hashSeed`（report）与 `simpleHash`（index）是同一 FNV；`mulberry32` 在 report 与 score 各写一份；`esc`（render）与 `escape`（settings）是同一转义                                                              | 新增 `lib/random.js`（`hashSeed`/`mulberry32`/`hashHex`）与 `lib/html.js`（`escapeHtml`），四处改为引用；index 的 diff 短哈希改为引用 `hashHex`，不再保留本地 `simpleHash`；bootstrap 输出不变（测试锁定） |
| 3   | 死代码     | 移除组件后仍留 `TEXTS` 键（`advice`/`hint`/`topTool`/`detailTitle`/`detailOpen*`/`moreBoard`）和 CSS（`.sev-detail-*`、`.sev-more-row`）                                                                        | 删除；`.sev-btn--ghost` 缺样式，补一条透明背景规则                                                                                                                                                         |
| 4   | 注释漂移   | `client.js` 头注释仍写"只在侧边栏 footer 加按钮+弹窗"                                                                                                                                                           | 拆分后 `client.js` 为生成文件，头注释改为 GENERATED FILE 横幅（来源 `client/*.js` + `scripts/build-client.mjs`），不再描述旧 seat 文案                                                                     |
| 5   | 回归       | `saveSettings` 在重构中丢失了串行化/原子写（AUDIT 已记录但被覆盖）                                                                                                                                              | 恢复 `settings.json.tmp` → `rename` + 队列，并加回归测试                                                                                                                                                   |
| 6   | 测试缺口   | 设置分组可能漏字段；并发写可能截断                                                                                                                                                                              | 新增"每个设置恰好属于一个分组"和"并发保存后文件完整、无 tmp 残留"两项测试                                                                                                                                  |
| 7   | 工程约定   | 无 .gitignore/.editorconfig                                                                                                                                                                                     | 添加（node_modules/dist/tgz/.DS_Store；LF、UTF-8、2 空格）；`dist/*.tgz` 为本地打包产物，不入库（已清理陈旧 `1.19.1.tgz`）                                                                                 |
| 8   | 表单加固   | `__full_form` 守卫、零权重求和拒绝、`FIELD_HELP`/`unit` 等表单加固逻辑有测试但未列入清理表                                                                                                                      | 补记：逻辑保留，`test/settings.test.js` 覆盖缺席 checkbox → false、零权重行为；不删除                                                                                                                      |

## 复查结论（未发现问题）

- 运行时无 TODO/FIXME/console.log（`console.log` 仅存在于 CLI 脚本的输出）。
- 无注释掉的代码块；`node --check` 全部通过。
- CSS 类均有非样式引用；TEXTS zh/en 键完全一致（测试覆盖 EN 回合条不出现 `undefined`）。
- 未使用导出仅 5 个，全部由测试或 CLI 脚本使用（`LEAK_RULES`（`test/critic.test.js`）、`LOOP_HINT_DIMENSIONS`（`test/loop.test.js` 跟踪 `EDIT_DIMENSIONS` 一致性）、`loadSettings`、`pickBaseUrl`、`runAcceptance`）。
- 包清单与 `files` 一致；`npm pack` 后无死文件。

## 后续落地（1.20.0）

1. **client.js 拆分完成**：`client/*.js`（13 个 part）+ `scripts/build-client.mjs`
   零依赖拼接；`prepack`/`pretest` 自动构建，doctor 增加 `client-build`
   新鲜度检查，`client/README.md` 记录流程。发布包仍只含构建后的单文件工厂。
2. ~~设置分组重复~~：已完成（host 下发 `group`/`groupZh`）。
3. **CLI 去重**：`scripts/lib.mjs` 统一 bridge/base/版本/超时 GET；accept 与
   verify 改为引用，新增 `test/cli.test.js`。
4. **Prettier + ESLint**：已加配置、devDependencies 与 `format:check`/`lint`
   脚本，源码已按 Prettier 格式化（`prettier --check` 当次通过）。
5. ~~测试 helper 抽取~~：已抽 `test/helpers.js`（`createHost(window, style)`）+ `test/client.test.js` 顶层 `createRoot`/`act` 导入，去掉 18 份重复；`BoardPanel` 与 `apply` 仍偏长（可接受，未再拆）。

## 验证

- `npm run release:check` 全绿：client 构建 → Prettier check → ESLint（0 error/0
  warning）→ doctor `--release` → **239 tests passing** → live accept 17/17。
- `npm publish --dry-run`：1.20.0，**47 files，164.9 kB**；npm 11 曾把带 `./`
  前缀的 bin target 判为 invalid 并移除，package.json 已改成 `scripts/*.mjs`，
  需重跑 dry-run 确认警告消失。
- 干净 profile 安装 tarball 的冒烟仍待跑（desktop profile 当前 link 到源码目录）。
- 真实窗口：图表页 `docs/ui/charts-1.19.0.png`；逐步轨迹页
  `docs/ui/steps-1.20.0.png`；设置页 `docs/ui/settings-1.18.3.png`。
