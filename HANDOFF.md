# HANDOFF

## 现在到哪一步（2026-11-23）

内核、命令面、面板在本机跑通；远端 `github.com/c3115644151/deed`（public，MIT）main 上有六次提交，**没有 tag**。
文档做了收敛：对外只有一个入口 `README.md`，行为权威是 `docs/DESIGN.md`，其余四份（`docs/INSTALL.md`、`docs/research.md`、`docs/README.md`、本文件）各有唯一职责。

## 最后一次验证（2026-11-23，本机）

- `npm test` → **91/91**（fold 17 · rules 9 · cli 49 · board 9 · docs 2 · heartbeat 2 · version 3），约 37 s；每条 CLI 用例都起真进程。
- `node examples/rebuild.mjs` → 37 条事件、四份任务书（时间戳随运行变化），`deed verify` → 「证据有效」，`deed doctor` → 「账本干净 · 37 条事件」+ 接入与心跳两行。
- `deed serve`（7419）：GET / 200；页面是账本纯函数，同一份账本同一组参数渲染出同样的字节。

## 这一轮：文件区重构（代码层 + 文档层）

**代码层**——查的是「谁依赖谁」。证据是层的反向依赖：`board/serve.mjs` 原本 import `../cli/store.mjs`、`../cli/version.mjs`、`../cli/words.mjs`，
面板反过来依赖命令面，而这三件都不是命令。所以：

- `cli/{store,words,version,heartbeat}.mjs` → `lib/`（适配层：账本文件与锁、时间格式、宿主规则文件、版本、心跳）。
- 新增 `core/digest.mjs`（sha256 原来在 `lib/store.mjs` 与 `cli/deed.mjs` 各写一遍）、`lib/format.mjs`（`stamp0`／`fileStamp`）、`lib/store.mjs` 的 `rel()`。
- 新增 `cli/audit.mjs`（账本 vs 工作区的核对，全部收显式 `root` 参数）与 `cli/brief.mjs`（`planBrief` 先算不写、`writeBrief` 只在事务提交钩子里写盘）。
- `cli/deed.mjs` 1009 → 868 行，只留参数解析、`transact`、会话定位、打印与 15 个 verb。
- 层依赖现在是 DAG：`core → {}`、`lib → core`、`cli → {core, lib, board}`、`board → {core, lib}`、`test → {support, lib, core}`；唯一保留的 `cli → board` 边是 `deed serve` 这个 verb。
- 判断（不做的事）：`cli/deed.mjs` 剩下的 868 行是一个 verb 一段的命令面，与 `transact`／`printState` 共用同一套事务，再拆只会多一层跳转；测试里 `const T = (n) => Date.UTC(...)` 重复三处，一行 fixture，不值得抽。

**文档层**——规则是「一格里只有一份」，所以：

- `design/DESIGN.md` → `docs/DESIGN.md`；`design/` 目录删除。
- `docs/POSITION.md` 并入 `README.md`「它站在哪一格」；`docs/research/` 的 8 份原文压成 `docs/research.md` 一页，原文从工作区移除（在 `2b2cd19` 里可取回）。
- 新增 `docs/INSTALL.md`（装／接／升级／卸／故障），`docs/README.md` 重写成索引 + 「新增文档先问」三条 + 改图的规矩。
- `README.md` 按新定位重写（200 行）：一句话定位 → 架构图 → 它是什么 → 装 → 接 → 一段的走法 → 谁动手 → 拒绝表 → 命令与面板 → 站在哪一格（对照表 + 不声称的事）→ 目录 → 已知代价。
- 自我描述换掉了：旧句「一个工作区的议事与执行机制」→ 新句「一个工作区的事实账本」，分界句「编排器决定 agent 干什么；deed 决定人敢不敢放行」。

## 待用户定（会改变方向的事）

1. **正式名**：`deed` 是暂用名；裸名在 npm 上已被占，发版要走 scope。
2. **这个仓库自己用不用自己**：根目录没有 `.deed/`，进度记在手写 HANDOFF 里——两个陌生人都点了这一条。自用的代价是账本进主仓、每轮真跑一遍 CLI。
3. **`tick` 的物理钩子**：`doctor` 只探测认得的宿主配置里有没有 `deed tick`，不替你装；要装就得写进宿主自己的配置。
4. **Noema 怎么接**：Noema 那边的通用治理层仍在原地；改成 `file:../deed` 依赖，还是维持两套。
5. **第一个 tag**：远端已有六个提交，tag 还没有。

## 没做的（诚实清单）

- **不防篡改**：账本随仓库走，有 push 权限的人能重写历史并让它自洽；`--by` 是自述不是鉴权。README 正面写了这条。
- **没有观测通道**：账本说「判过了」，但没人常规核对工作区现在还是不是那一份（`deed verify` 是雏形）。
- **`verify`／`gate` 不会自己跑**：没做成钩子，靠调用。
- **`doctor` 只定位不修**：坏行要人整行挪走；它给唯一一条修法，不自动执行。
- **只有一份演示账本**（`examples/contract`）。
- **架构图手维护**：由 archify 生成过，之后改过标签；过期回执已删，规矩在 `docs/README.md`。
- **「陌生人能不能照着动手」只由我自己走过一遍**：空白工作区六步能通，但没有找不知情的人真跑。

## 下一步

1. 拿一个真实工作区接一次，验证陌生 agent 照 `AGENTS.md` 能不能正确动手。
2. 打第一个 tag。
3. 再谈 Noema 怎么接。
