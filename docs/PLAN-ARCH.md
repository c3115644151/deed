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

### R1 单个文件的分支数有上限（行数只是它的影子）

- **规则**：一个文件只回答**一个**问题；决策分支（`if`/`case`/`?`）合计 ≤ 12，行数随之自然落在 150–260 之间。
  行数上限是软指标（用来发现异常），**分支数是硬指标**。
- **为什么**：agent 读 900 行不困难，难的是**插错位置**——每多一个分支，多一次"我改的是不是同一条路"的判断。
  分支数才是"这个文件在管几件事"的近似度量；行数会被注释和长表达式污染。
- **超过怎么办**（这条是边界，不是自由）：
  1. 先说清它其实在答**第二个问题**，按那个问题拆（例如 `review` 拆成"清单"与"结论"）；
  2. 若是同一问题但确实长（大解析器、大表格），把**数据**和**逻辑**分开：表进 `data/*.mjs`（允许 800 行，检查豁免），
     逻辑留在 `policy/*`；
  3. 若两者都不成立，写一行 `why-long:` 注释说明它为什么不能拆，并在 `checks` 里登记豁免（豁免有 owner）。
- **禁止**：按行号切两半、起名 `x-1.mjs`/`x-2.mjs`。那是碎片化，不是分解——碎片化之后没人知道去哪个半区改。
- **检测** `checks:file-size`：报"文件 / 行数 / 分支数 / 上限"，分支超限一律红，行数超限只列不改。
- **修法**：按上面三条之一处置，不许沉默通过。

### R2 一类事实一个位置，加事实不改别人的分支

- **这一条常被误读**，先把范围说死：它只说**一类事实**（事件的一种 `kind`），不说"每次改动都新建文件"。
  - 同域里多一种 `kind`（比如 `task.uncarry` 之于 `work`）：在 `work.mjs` 里**加一个函数分支**，不新建文件；
  - 新开一个**域**（比如"议题"之于"任务"）：才新建 `events/topic.mjs` + `reducers/topic.mjs`，注册表加一行。
  - 普通功能开发、修 bug、加字段：**不产生新文件**，也不产生兼容层——它改的是已有的那个 reducer / policy 文件。
- **为什么**：agent 最容易做对的是"在一个已命名的位置里加一个同构函数"，最容易做错的是"在 1000 行 switch 的中间插一段"。
  兼容层之所以不需要，是因为注册表把"谁处理哪种事实"的接线集中在一处，加一个 kind 不触碰别的 kind 的代码。
- **与 R1 的冲突**：只有当同一个域文件也超过分支上限时才冲突，处置见 R1 的三选一（通常是"这个域在管两件事"，再分一次域）。
- **检测** `checks:registry`：KINDS ↔ reducers 双向对账；再加一条"同域新增分支必须在该域文件内"（对比上一版，若某 kind 的处理散落到两个文件就报）。
- **修法**：把分支搬回它的域文件，注册表补一行。

### R3 依赖方向必须可断言

- **import 图是什么**：每个 `.mjs` 顶部的 `import … from "…"` 连成的有向图——边的方向就是"谁依赖谁"。
  它是**静态**的：只读源码里的 import 语句，不看运行时 `import()` 动态加载，也不看通过参数传进来的函数。
  够用，是因为我们所有跨层引用都写在文件头部，没有动态加载。
- **规则**：`core/**` 不许 import `lib` / `cli` / `board` / `adapters`；`replay`、`policy`、`facts` 之间按
  `policy → facts`、`replay → events` 单向；只允许 `cli/board/adapter → core/lib`。
- **为什么**：写在注释里的边界对 agent 无效，写进检查才有效。而且它能抓住"顺手在里面 import 一个 render"这种漂移。
- **检测** `checks:layers`：扫 import 图，违例报 `文件:行`、它引了谁、以及"应该走哪个出口"。
- **修法**：把查询下沉 `facts/`，把 io 推回 `cli`，把需要的值当参数传进来。

### R4 一个概念一个出口（出口＝审查可读的最小单元）

- **规则**：同一个判断只许有一处实现，其余调用方必须问它；这一处必须是**独立文件**，名字就是那个问题
  （`policy/review-door.mjs`）。首批三个概念：审查能不能开始、能不能判、能不能签。
- **和 R1 的关系**：R1 按"问题"切**文件**；R4 按"概念"约束**调用方**——一个概念的所有调用方都指向同一个出口文件。
  两者合起来就是你说的那句：**按概念分模块，模块里每个文件只答一个问题**。
- **和审查的关系**（你补的这一层，我认）：出口文件同时就是**审查清单该读的东西**。审查者读 `review-door.mjs`
  就能判断"谁能开审"，不必读 `render`/`gates`/`adapter` 三处各自的实现。清单的"审什么"与结构出口对齐，
  是这条规则的真实收益——不只是"少改几个文件"，而是**审查有一个可指的地方**。
- **检测** `checks:outlets`：对登记过的概念，扫源码里是否还有第二处"同义判断"（先用人工登记的关键词 +
  函数名近似匹配）；第一版只列候选，人工确认后才升级为红。
- **修法**：把判断搬进出口文件，其余处改成调用；调用方若需要不同的措辞，那是**话术**，留在调用方。

### R5a 机制改动要留"为什么现在动它"

- **先分清两种行为**（这是你问的那点，我之前没写清）：
  - **机制改动**：改系统自身——规则、事件、检查、命令面、面板。它改变"系统怎么判断"，影响面广；
  - **活**：用系统做事——交付一个条目、写一段实现。它改变"这个项目的产物"。
- **规则**：机制改动落一条记录：动了哪一层、半径（文件数）、与上次被刹车的事有什么不同。
  活不要求这个（它已经有任务与标准那一套）。
- **检测** `checks:radius`：按账本里每次提交触及的路径算文件数、热点排行；超预算（暂定 8）的机制改动列出来要一句解释。
- **修法**：拆改动，或写清为什么这次必须一次动这么多。

### R5b 体检发现显著异常时，强制停一轮

- **规则**：体检报出"显著异常"时，下一步不是"继续交活"，而是**停**：写清哪一条红了、可能的结构原因、要不要动结构。
  这是你补的那一层，我认为它比 R5a 更重要——R5a 管的是"事后记账"，R5b 管的是"当场刹车"。
- **什么叫"显著"**（必须机械，否则又变成我凭感觉）：同时满足两条
  1. 至少一条**硬检查**变红（`layers` / `registry` / 分支数 / 文件预算）；
  2. 且它出现在**与本次改动相关的路径**上（同一个域、或本次触及的文件）。
- **检测**：不需要新检查——它是 `policy/step.mjs` 的一条排序规则：异常优先于"继续交付"。
  面板与 `deed state` 的下一步显示 `agent · 停一轮：说清 `checks` 里那条红`。
- **修法**：停 → 说明 → 要么修结构，要么登记豁免（有 owner 和期限）。

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

**大小上限**（分支数硬、行数软——见 R1）：

| 类别 | 行数（软） | 分支（硬） | 今天最接近的 |
|---|---|---|---|
| `events/*` | 220 | ≤ 12 | events.mjs 545 行 / 34 分支 → 拆 8 份 |
| `replay/reducers/*` | 260 | ≤ 16 | fold.mjs 1149 行 / 34 分支 → 拆 7 份 |
| `policy/*` | 150 | ≤ 8 | rules.mjs 825 行 / 42 导出 → 拆 5 份 |
| `facts/*` | 200 | ≤ 8 | — |
| `cli/verbs/*` | 200 | ≤ 10 | submit 608 / review 409 |
| `board/render/*` | 400 | ≤ 12 | render 1237 → 拆 4 份（屏 + 卡片 + 公共件） |
| `data/*` | 800（豁免） | — | 新的：表与常量，不带逻辑 |

行数超了只**列出来**；分支超了**红**。豁免（`why-long:`）要写 owner 与期限。

**域划分与 case 数**（合计 34）：talk 3 · topic 3 · work 10 · review 5 · segment 4 · session 5 · legacy 4。

### 4.1 地图与命名：解决"拆细之后找不到、又新建一个"

拆细的真实代价是**检索**：文件一多，"该在哪儿改"和"是不是已经有一个了"就变成两个问题。
两条对应手段，都要能被检查：

- **地图** `docs/STRUCTURE.md`：一行一个文件，格式 `路径 · 它回答什么问题 · 谁引入它`。
  新文件先在地图上占一行，再写实现。检查 `checks:tree`：**目录里每个 .mjs 必须在地图上有一行，地图上每一行也必须真有文件**
  ——双向对账，缺一边就报。这就是防"边缘化文件"的机制：没有地图行的文件会当场红，想偷偷新建一个功能重复的文件，得先在地图上写清它和已有的那个有什么不同。
- **命名规则**：文件名 = 它回答的问题（`review-door.mjs` 不是 `reviewHelpers.mjs`）；同一目录里**禁止同义名**
  （检查：同目录文件名两两做词根重合度比对，超过阈值列出来人工确认）。agent 是**按名字找文件**的，命名不一致等于找不到。

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
| `tree` | 目录 ↔ 地图双向对账 | 硬 | 新增 |
| `stop` | 硬检查红 且 落在本次触及路径 → 下一步改成"停一轮" | 硬（排序规则） | 新增 |
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

## 12. 需要你裁的八点

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

7. **分支上限**：12 个分支／文件，这个数要不要按域调（`reducers/work` 天然分支多，可能要给 16）？
8. **地图是否当硬门**：`docs/STRUCTURE.md` 与目录双向对账，缺一条就红——现在没有这份地图，等于要先补齐 35 个文件的行。
