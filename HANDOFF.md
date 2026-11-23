# HANDOFF

## 现在到哪一步（2026-11-23）

装在**这台机器上**，并且这个仓库**自己用自己的账本**（`.\.deed/` 随仓库提交）：命令 `deed` 在 PATH 上，规则块粘在 `AGENTS.md` 末尾，第一期 S01 的三条承诺已交付、任务书已出。
远端 `github.com/c3115644151/deed`（public，MIT）main 上有八次提交，**没有 tag**。

## 最后一次验证（2026-11-23，本机）

- `npm test` → **94/94**（fold 17 · rules 9 · cli 52 · board 9 · docs 2 · heartbeat 2 · version 3），约 40 s；每条 CLI 用例都起真进程。
- `deed verify` → exit 0，「证据有效」；`deed doctor` → 「账本干净 · 11 条事件」，心跳一行仍是「未接」。
- `deed serve`（7317）→ GET `/` 200，字节数随账本增长（4 条事件 10768、8 条 12470、11 条 13322、13 条 14238）；审查者用同一条账本本地重渲，与响应体逐字节相等；`/state` 与页面同源；`/events` 是 `text/event-stream`，开场时刻与本机同一个钟（11/23 08:45）。
- `npm link` 之后在 `C:\Users\NUC` 敲 `deed --version` → `0.2.0`（不再需要进仓库目录）。

## 这一轮：装到本机（把 deed 自己当工作区）

装的过程暴露了四处「新机器上用不下去」的地方，先修再装：

- `deed --version` 原来是陌生动词，而陌生动词走 `fail()`、外面没人接住，拒绝会以 Node 调用栈收场。现在 `--version`／`-v`／`version` 在动词表之前回答；陌生动词用 `reject()` 单行退出。
- 没接过的目录里 `deed tick` **能写进去**，写完之后 `deed state` 又说「这个目录还没接 deed」——写进去的读不出来。守卫落在 `transact`（每个 verb 都过的唯一一处）：账本里没有门槛就拒，`config.change` 例外，因为 `init` 的基线正是给目录立门槛的那一步。
- `deed state` 在没有门槛的目录里照样给「下一步」；`deed verify` 对着空账本说「证据有效」。现在两句都先问「接过了没有」，答没有就说没有。
- 工作区快照把 `.tmp/`、`.archify/` 这些本机草稿也算进「动了哪些路径」，现在跟 `.shots/` 一样跳过。
- 面板的 SSE 开场时刻读 UTC（`when(at)` 默认时区），页面读本机时区——同一屏两个钟。现在流用 `zoneOfMachine()`，board 测试把开场 data 和页面的时区对齐。

装的动作：`npm link` → `deed init --said … --review "src/**,apps/**,cli/**,core/**,lib/**,board/**" --exempt "docs/**,*.md,examples/**,.github/**"` → `deed init --print-agents` 的块原样粘进 `AGENTS.md` → 三条承诺交付 → `deed review --segment S01.1` 出任务书 → 另一个 agent（`reviewer:s1`）照任务书复核并落了 pass。

审查者留下一条真缺陷（它判「不构成 fail」，我同意要修）：**被拒的 `tick` 仍会在空目录留下 `.deed/`、`.deed/log`、`.deed/review` 三个空目录**——`withLock` 里的 `ensureDirs` 先建目录再判定，于是「被拒的动作一个字也不落盘」只对事件成立、对目录不成立；测试也只断言了没有事件行。修法是 `transact` 在加锁之前先折一遍（`readEvents` 无副作用），没门槛且不是 `config.change` 就拒，连锁都不用拿。
这一段已经封存，所以这条修复不能挤进 S01.1：先由用户判决这一段，再开新段做它（新的证据、新的任务书、再判一次）。

## 待用户定（会改变方向的事）

1. **S01.1 的签收**：段判过之后只有用户能 `deed sign --words "<原话>"`。这一步没做过，签收链在本仓库里还是空的。
2. **正式名**：`deed` 是暂用名；裸名在 npm 上已被占，发版要走 scope。
3. **`tick` 的物理钩子**：`doctor` 只探测认得的宿主配置（`.claude/settings.json`、`.codex/config.toml`）里有没有 `deed tick`，不替你装；这台机器上跑的是 DSH，认得的宿主配置一个都不在，所以心跳一直是「未接」。
4. **Noema 怎么接**：Noema 那边的通用治理层仍在原地；改成 `file:../deed` 依赖，还是维持两套。
5. **第一个 tag**：远端已有八次提交，tag 还没有。

## 没做的（诚实清单）

- **不防篡改**：账本随仓库走，有 push 权限的人能重写历史并让它自洽；`--by` 是自述不是鉴权。README 正面写了这条。
- **没有观测通道**：账本说「判过了」，但没人常规核对工作区现在还是不是那一份（`deed verify` 是雏形）。
- **`verify`／`gate` 不会自己跑**：没做成钩子，靠调用。
- **`doctor` 只定位不修**：坏行要人整行挪走；它给唯一一条修法，不自动执行。
- **`gates` 没有专门的改法**：`init` 只认 `--review`／`--exempt`／`--port`，改门要手改 `.deed/config.json` 再 `init --force --why`。
- **只有一份演示账本**（`examples/contract`）和本仓库这一份真账本。
- **架构图手维护**：由 archify 生成过，之后改过标签；过期回执已删，规矩在 `docs/README.md`。
- **「陌生人能不能照着动手」只由我自己走过一遍**：空白工作区六步能通，但没有找不知情的人真跑。

## 下一步

1. 用户签收 S01（`deed state` 会给命令）。
2. 拿一个真实工作区接一次，验证陌生 agent 照 `AGENTS.md` 能不能正确动手。
3. 打第一个 tag。
