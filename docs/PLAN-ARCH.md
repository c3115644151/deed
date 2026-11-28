# deed 架构重构方案（草案 · 待审）

> 状态：**草案，未执行**。审的对象是这份文件，不是代码。
> 建立：2026-11-29。讨论记录见 `docs/RETHINK.md`。
> 一句话：把 deed 从"人能维护的结构"改成"agent 能维护的结构"，并用可检测的约束取代提醒。

---

## 1. 目标与判据

三条可量的判据，缺一条这套方案就不成立：

| 判据 | 今天 | 目标 |
|---|---|---|
| **加一条事件要读多少** | 在 `core/events.mjs`(545 行) 与 `core/fold.mjs`(1149 行) 里各找一处，两处必须同步 | 新建 2 个文件 + 注册表 1 行；不读别人的分支 |
| **改一个概念要动几层** | 「谁能启动审查」散在 verbs / gates / render / adapter / rules / 测试，一次动 23 个文件 | 一处判（`policy/review.mjs`），其余三层都问它；改动 ≤ 5 文件 |
| **违规会不会自己红** | 不会——靠人看 | 依赖方向、文件行数、注册表完备、概念出口各自有检查，违例报文件与行 |

---

## 2. 现状诊断（全部是量出来的）

```
core/fold.mjs         1149 行 · 代码 917 · 34 个 case · 6 个导出
core/events.mjs        545 行 · 代码 411 · 34 个 case · 6 个导出
core/rules.mjs         825 行 · 代码 619 · 42 个导出
board/render.mjs      1237 行 · 代码 1152
cli/verbs/submit.mjs   608 行 · cli/session.mjs 445 行 · 21 个导出
```

三个病灶，不是"风格问题"：

1. **同一份事实的两半**：34 个 kind 在 `events.mjs` 里有一份校验，在 `fold.mjs` 里有一份重放。
   新增一条事件 = 在 A 找一个空位 + 在 B 找同一个空位；两个文件都 500–1100 行，必须整体读到对的位置。
   `task.uncarry` 只落在 3 个文件字面上，但**每次都要读 34 个 case 才敢确认插对了**。
2. **没有边界的概念**：`rules.mjs` 42 个导出，策略（该不该审）、投影（谁在手上）、查询（数条目）混在一起。
   于是"审查由谁启动"没有一处能改——23 个文件的改动就是这么来的。
3. **一个函数五种职责**：`fold` 同时做重放、逐条判定、携带、关闭、作废。每一次新机制都要在同一个函数里
   加一条分支，且可能与已有分支互相干扰（本轮就撞出过「pass 之后 fail，段头还挂着 pass」）。

---

## 3. 设计约束：给 agent 的五条规则

每条都必须能被检查，否则它对 agent 等于不存在（这是评论区 280 楼的诊断：不提醒就不探索）。
每条都写成「规则 · 为什么对 agent 成立 · 怎么检测 · 违例怎么修」。

### R1 单文件知道的事有上限

- **规则**：一个文件只回答一个问题，且不超过上限（见 §4 的表）。
- **为什么**：agent 的读取是稀缺资源；它按"模式"找位置，文件越长越容易插错地方。
  人的直觉是"内聚"，agent 的直觉是"我读得完吗"。
- **检测** `checks:file-size`：按路径类别比对行数上限，超了报文件与实际行数。
- **修法**：按问题拆文件（不是按"代码长了就切两半"）。

### R2 加事实＝加文件，不改别人的分支

- **规则**：新增一条事件只动 `events/<域>.mjs`、`replay/reducers/<域>.mjs`、注册表一行。
- **为什么**：agent 最容易做对的编辑是"新建一个结构完整的文件"，最容易做错的是"在 1000 行 switch 里插分支"。
  这也是 SOLID 里 O（开闭）对 agent 唯一有效的形态。
- **检测** `checks:registry`：KINDS 与 reducer 双向对账（有定义没重放、有重放没定义，都报）。
- **修法**：把分支搬进对应域的 reducer，注册表补一行。

### R3 依赖方向必须可断言

- **规则**：`core` 不 import `lib`/`cli`/`board`/`adapters`；`policy` 与 `replay` 不 import `cli`/`board`；
  只允许 `cli/board/adapter → core/lib`。
- **为什么**："业务不依赖框架"写在注释里对 agent 无效；写进检查才有效。
- **检测** `checks:layers`：扫 import 图，违例报 `文件:行` 与它引了谁。
- **修法**：把查询下沉到 `facts/`，把 io 推回 `cli`。

### R4 一个概念一个出口

- **规则**：一个判断只能有一处实现，其余调用方必须问它。
  首批三个概念：**审查能不能开始**、**能不能判**、**能不能签**。
- **为什么**：概念分散时，agent 改一处就漏三处——上一轮"出清单只在面板按"动了 23 个文件，
  正是因为这判断在 6 个地方各写了一遍。
- **检测** `checks:outlets`：对列入清单的概念，扫源码里是否出现"重复判断的特征串"
  （先用人工登记的 `concept:` 注释 + 关键词清单，机械判：同一函数被复制超过 1 次的近似模式）。
  这条检查第一版会比较粗，先做到"能在评审时把候选列出来"，再逐步收紧。
- **修法**：把判断搬进 `policy/<问题>.mjs`，其余处改成调用。

### R5 变更要有"为什么现在动它"的位置

- **规则**：每次机制改动落一条记录：动了哪一层、半径（文件数）、与上次被刹车的那件事的关系。
- **为什么**：人类维护者心里有这笔账（上次为什么踩刹车），agent 没有；不落盘就永远从零开始。
- **检测**：`checks:radius`：按账本里每条提交触及的路径，算每次机制改动的文件数与热点文件排行；
  超过预算（暂定 8 个文件）的改动在体检里列出来，要求一句解释。
- **修法**：拆改动，或写清为什么这次必须一次动这么多。

---

## 4. 目标结构

```
core/
  events/
    index.mjs          汇总：KINDS、validate、EVENT_VERSION（≤ 120 行）
    talk.mjs           turn / reply / point.add
    topic.mjs          topic.create / establish / release
    work.mjs           task.add / context / title / criteria / done / undo / uncarry / carry / order / defer / drop
    review.mjs         review.brief / withdraw / log / verdict.pass / overturn
    segment.mjs        segment.plan / seal / judge.pass / judge.rework
    session.mjs        project.declare / config.change / goal.set / sign / shelve
    legacy.mjs         ask.raise / resolve / withdraw（只读：旧账本还要能重放）
  replay/
    index.mjs          遍历事件 → 查注册表 → 调 reducer；无业务（≤ 80 行）
    reducers/
      talk.mjs topic.mjs work.mjs review.mjs segment.mjs session.mjs legacy.mjs
  policy/
    review.mjs         该不该审、清单过没过期、结论立不立得住、审查门（R4 的出口）
    step.mjs           下一步是谁、做什么（只问 facts 与 policy，不做别的判断）
    sign.mjs           能不能签、能不能封、带着走哪些未结项
    session.mjs        谁在推进、什么形态、目的、压力读数
    segment.mjs        哪一段收活、段还能不能再进条目
  facts/
    tasks.mjs          tasksIn / countIn / byOrder / lastDelivery / pointsAtNothing / unpinned
    turns.mjs          userTurns / turnNumbers
  checks.mjs           体检登记处（唯一入口）
lib/                   store / record / version / panel / format（不动）
cli/                   spec / verbs/* / session.mjs（只做 io 与话术）
board/                 serve / gates / render（只问 policy，不自己判）
adapters/dsh/          index / verdicts（只问 policy，不自己判）
```

**大小上限**（违反即红）：

| 类别 | 上限 | 今天最接近的 |
|---|---|---|
| `events/*` | 220 行 | events.mjs 545 → 拆 8 份 |
| `replay/reducers/*` | 260 行 | fold.mjs 1149 → 拆 7 份 |
| `policy/*` | 150 行 | rules.mjs 825 / 42 导出 → 拆 5 份 |
| `facts/*` | 200 行 | — |
| `cli/verbs/*` | 200 行 | submit 608 / review 409 |
| `board/render/*` | 400 行 | render 1237 → 拆 4 份（屏 + 卡片 + 公共件） |

**域划分与 case 数**（合计 34）：talk 3 · topic 3 · work 10 · review 5 · segment 4 · session 5 · legacy 4。

---

## 5. 事件与重放的形态

**定义**（`core/events/work.mjs`）：

```js
export const KINDS = ["task.add", "task.done", /* … */];
export const validate = (ev, meaning) => { /* 只校验，不读盘 */ };
export const since = { "task.uncarry": 37 };   // 第几版起有它
```

**重放**（`core/replay/reducers/work.mjs`）：

```js
export const reduce = (ctx, ev) => {
  // ctx = { session, doc, meaning, at }
  // 一个 case 一个动作，不许 io、不许读时钟
};
```

**分发**（`core/replay/index.mjs`，全文预计 60 行）：查表、取 reducer、调用；找不到 reducer 才报错
（过渡期内允许 fallback 到旧的 `fold` switch，见 §8-P1）。

**版本**：拆文件不改含义，`EVENT_VERSION` 维持 37。`meaningOf` 的分支跟着对应 reducer 走，
不再全仓散着 `if (meaning >= X)`。

---

## 6. 策略层：42 个导出怎么分

| 目标文件 | 收哪些导出 | 数量 |
|---|---|---|
| `policy/session.mjs` | currentSession · sessionById · goalOf · reading · pressure · groupsOf · doingOf | 7 |
| `policy/segment.mjs` | openSegment · takingSegment · queuedSegments · segmentRoom · SEGMENT_MAX · lastSegmentChange | 6 |
| `policy/review.mjs` | reviewOf · reviewState · verdictStands · needsReview · reviewable · sheetHolds · freshBrief · lastBrief · reviewDue | 9 |
| `policy/period.mjs` | needsPeriodReview · periodState · periodFresh · periodReviewOf · lastPeriodBrief · stalePeriod | 6 |
| `policy/step.mjs` | nextAction | 1（最大，拆成"判断 + 话术"两半） |
| `policy/sign.mjs` | signBlockers · sealBlockers · exemptSegments · debt | 4 |
| `facts/tasks.mjs` | tasksIn · countIn · byOrder · lastDelivery · pointsAtNothing · unpinned | 6 |
| `facts/turns.mjs` | userTurns · turnNumbers | 2 |
| `policy/config.mjs` | configDrift | 1 |

不为"看起来整齐"而拆：每个文件都必须能回答**一个**问题，名字就是那个问题。

---

## 7. 概念出口（R4 的首批落地）

三个概念先收口，每个只留一处判断：

1. **审查能不能开始**：`policy/review.mjs` 出 `reviewDoor(config, session, segment) → { can, why, segment }`。
   `board/gates.mjs`、`board/render.mjs`、`adapters/dsh`、`cli/verbs/review.mjs` 全部问它，
   删掉各自那套「该审 + 没在判 + 有可判的东西」。
2. **能不能判**（判决按钮 / verdict.pass 的准入）：同样收进 `policy/review.mjs`。
3. **能不能签**：已经只有 `signBlockers` 一处，但 `render` 与 `gates` 各自又算了一遍开销——
   统一成 `signDoor`。

---

## 8. 迁移（五段，每段可停可回退）

**P0 先量**（不改结构，1 次提交）
- 新增三条检查：`layers`、`registry`（此时必然全过）、`file-size`（此时必然全红，全红正是基线）。
- 把 34 个 case、42 个导出、每个文件行数记成基线表，写进本文件附录。

**P1 纵向切片：只搬 `task.uncarry`**
- 新建 `events/work.mjs` + `replay/reducers/work.mjs`，注册表只有一条；
  `fold` 的 `case "task.uncarry"` 删除，改为分发时查注册表、查不到再走旧 switch。
- 验收：`task.uncarry` 的三个用例照旧过；新旧两条路在同一个账本上重放出同一份文档（对拍）。
- 量：碰了 4 个文件、写了多少行、读了多少行——写进本文件附录，作为"手感"的第一个数据点。

**P2 按域搬完重放**
- 顺序：work → review → segment → talk/topic/session → legacy。
- 每搬一个域：删 `fold` 里对应的 case、补用例、对拍（旧账本上新旧重放结果逐字段相等）。
- 一个域一个提交，禁止跨域混提。

**P3 策略按问题拆**
- 先建 `policy/*` 与 `facts/*`，旧的 `core/rules.mjs` 变成**薄转出口**（re-export），
  同时改调用点；转出口的 owner 与删除日期写进 `docs/DESIGN.md`。
- 验收：`rules.mjs` 少于 60 行，且没有任何判断逻辑；调用点全部指向 `policy/*`。

**P4 概念出口收口**（§7）
- 验收：`render/gates/adapter` 里不再出现"该审 + 没在判"的特征串；`checks:outlets` 通过。

**P5 cli 瘦身**
- `submit` 拆成 `plan-apply`（把清单变更转成事件，纯函数）+ `submit`（读盘、落账、话术）；
  `review` 同样拆成 `verdict-apply` + `review`。
- 验收：每个 verb ≤ 200 行；`cli/session.mjs` 只留 io 帮助（≤ 150 行）。

---

## 9. 门与度量

| 检查 | 判什么 | 首版阈值 | 状态 |
|---|---|---|---|
| `layers` | import 方向 | 硬 | 新增 |
| `registry` | KINDS ↔ reducers 双向 | 硬 | 新增 |
| `file-size` | §4 的表 | 软→硬（P2 结束转硬） | 新增 |
| `outlets` | 概念重复判断 | 软（列候选） | 新增 |
| `radius` | 每次机制改动的文件数 | 先只记数，3 周后定预算 | 新增 |

原则：**先量后门**。任何检查在变成硬门之前，必须先有基线数据，否则等于拍脑袋设阈值。

---

## 10. 与现有治理的兼容

- **账本**：拆文件不改事件含义，`EVENT_VERSION` 不动 37；旧账本逐行照读，对拍是硬验收。
- **命令面**：全程不改动词与开关；只在 P5 拆内部分层，外部行为不变。
- **面板**：P4 之后 `gates`/`render` 只问 policy；渲染断言保持"关键句 + 按钮在不在"，不做 HTML 全等。
- **文档**：`docs/DESIGN.md` 补一节「结构与边界」；`AGENTS.md` 的规则块由 `deed init --print-agents` 重新出。
- **测试**：每搬一个域补该域的 reducer 用例（同一账本、同一期望）；CLI 用例只测话术与流程。

---

## 11. 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 拆分期间双路径 | 旧 switch 与新注册表并存 | P1 就定"注册表优先、旧 switch 兜底"，每搬完一个域立即删掉那段 switch |
| 对拍成本被低估 | 旧账本 1000+ 事件，字段多 | 对拍不逐事件，只比最终 doc 的 JSON（排序稳定化后深比较） |
| 概念出口检查太粗 | 特征串会误报 | 首版只列候选，人工确认后才升级 |
| 迁移把当前进度拖住 | 系统处于"暂停使用"状态 | 正好：没有真实使用在推进，迁移窗口是干净的 |

---

## 12. 需要你裁的六点

1. **域划分**：talk / topic / work / review / segment / session / legacy 七个，认不认？
2. **过渡期薄转出口**（`rules.mjs` re-export 到 `policy/*`）：允许，还是要求一次到位？
3. **文件上限**：220 / 260 / 150 / 200 / 400 这一组数值，改不改？
4. **change radius**：先只记数（我建议），还是直接设为 8 文件硬门？
5. **事件定义与校验合并**进 `events/<域>.mjs`：认不认？（不认就保持 `events.mjs` 一张表，只拆 fold）
6. **体检登记处唯一入口**：新检查必须登记进 `checks.mjs` 才算数——这条要不要写死？

---

## 附录 A：基线（P0 之后填）

- 文件行数表：待填
- 34 case → 域映射：见 §4
- 42 导出 → 文件映射：见 §6
- `task.uncarry` 切片实测（P1 后填）：碰了几个文件 / 读了多少行 / 与旧的对照
