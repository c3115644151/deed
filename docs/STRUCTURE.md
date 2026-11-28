# STRUCTURE · 这份代码由哪些文件组成

> 一行一个文件：它回答什么问题。新文件先在这里占一行再写实现；
> 体检里 `tree` 那条会对账——目录里有、这里没有，或者这里有、目录里没有，都报出来。
> 这不是目录树，是「我该去哪儿改」的索引。

| 文件 | 它回答的问题 |
|---|---|
| `adapters/dsh/verdicts.mjs` | 审查者落完结论，得有人把作者叫回来。账本里出现"结论"这一行就是那一刻 |
| `board/gates.mjs` | 人只在面板上出手 |
| `board/render.mjs` | render |
| `board/serve.mjs` | serve |
| `cli/brief.mjs` | 审查清单是唯一落到账本外、又要交给别人的文件 |
| `cli/deed.mjs` | 命令面只做一件事 |
| `cli/ledger.mjs` | 账本校验 |
| `cli/panel.mjs` | 面板跟着命令走，不跟着开机走 |
| `cli/pins.mjs` | 一条交付记下的两样东西 |
| `cli/plan.mjs` | plan |
| `cli/session.mjs` | The command surface. Every verb appends  |
| `cli/spec.mjs` | 一个动词认哪些开关，只有这一处说。parse 拿它拒掉拼错的开关，帮助也拿它排版 |
| `cli/trace.mjs` | trace |
| `cli/verbs/check.mjs` | 体检 |
| `cli/verbs/debug.mjs` | 观察层只印量。这里的每一行都要能被人拿着工具复核 |
| `cli/verbs/init.mjs` | Printing the block is the only way deed  |
| `cli/verbs/panel.mjs` | 一条命令只说一件事 |
| `cli/verbs/plan.mjs` | 清单 |
| `cli/verbs/point.mjs` | （还没写：补一句它回答什么） |
| `cli/verbs/project.mjs` | "core=core |
| `cli/verbs/reply.mjs` | 我这一侧说的话也是原文 |
| `cli/verbs/review.mjs` | Two verbs in one, on purpose |
| `cli/verbs/say.mjs` | 一轮 = 你和用户之间的一轮对话。said 是位置参数 |
| `cli/verbs/serve.mjs` | Serving a directory that never took the  |
| `cli/verbs/sign.mjs` | 签收与归档是同一支笔的两种落法 |
| `cli/verbs/state.mjs` | 只读动词也过开关表 |
| `cli/verbs/submit.mjs` | 数由工具采。node --test 两种输出（TAP 的 # tests 与默认 |
| `cli/verbs/topic.mjs` | 「release」「establish」是人的动作，只在面板上按 |
| `core/checks.mjs` | checks |
| `core/digest.mjs` | 一处算指纹 |
| `core/events/index.mjs` | events |
| `core/events/legacy.mjs` | events/legacy |
| `core/events/review.mjs` | events/review |
| `core/events/segment.mjs` | events/segment |
| `core/events/session.mjs` | events/session |
| `core/events/shape.mjs` | events/shape |
| `core/events/talk.mjs` | events/talk |
| `core/events/topic.mjs` | events/topic |
| `core/events/work.mjs` | events/work |
| `core/facts/errors.mjs` | facts/errors |
| `core/facts/paths.mjs` | facts/paths |
| `core/facts/review.mjs` | facts/review |
| `core/facts/segment.mjs` | facts/segment |
| `core/facts/session.mjs` | facts/session |
| `core/facts/task.mjs` | facts/task |
| `core/facts/turns.mjs` | facts/turns |
| `core/fold.mjs` | fold |
| `core/policy/period.mjs` | policy/period |
| `core/policy/review.mjs` | policy/review |
| `core/policy/segment.mjs` | policy/segment |
| `core/policy/session.mjs` | policy/session |
| `core/policy/sign.mjs` | policy/sign |
| `core/policy/step.mjs` | policy/step |
| `core/policy/task.mjs` | policy/task |
| `core/replay/index.mjs` | replay |
| `core/replay/reducers/brief.mjs` | review 域（一） |
| `core/replay/reducers/delivery.mjs` | work 域（二） |
| `core/replay/reducers/legacy.mjs` | legacy 域 |
| `core/replay/reducers/segment.mjs` | segment 域 |
| `core/replay/reducers/session.mjs` | session 域 |
| `core/replay/reducers/talk.mjs` | talk 域 |
| `core/replay/reducers/topic.mjs` | topic 域 |
| `core/replay/reducers/verdict.mjs` | review 域（二） |
| `core/replay/reducers/work.mjs` | work 域（一） |
| `core/stale.mjs` | stale |
| `lib/format.mjs` | 给人看的时间 |
| `lib/heartbeat.mjs` | 心跳 |
| `lib/landed.mjs` | 记账那一刻称下的字节就是这条记录指着的那份内容。读账本的人回不到那一刻， |
| `lib/panel.mjs` | 面板是这台机器上的一个进程，不是账本里的一件事 |
| `lib/record.mjs` | 一条要落进账本的行 |
| `lib/store.mjs` | store |
| `lib/tree.mjs` | tree |
| `lib/version.mjs` | 版本 |
| `lib/words.mjs` | words |
| `test/support/cli.mjs` | 面板默认关掉 |
