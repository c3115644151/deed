# 这一期要做成什么
把操作面收成一个清单文件：写清单、deed submit 一次记账；要不要审看规模。

<!-- 这份文件就是这一期的清单：改它，然后 deed submit 一次记账。
     每条任务一行，开头是一个方框：方框里 ? = 新条目、空着 = 还没做、x = 已交付、~ = 不做了。
     方框后面跟着号和标题；改的时候只动方框与下面那几行，别改号和标题。
     一条任务可带一行 依据：能点回哪一轮立了它的原话；标题说的是要消掉什么现象。
     勾上就得写一行「交付：」——跑了什么、结果几比几；不做了就得写一行「理由：」。
     注记两行：箭头加「延后：」这一次不做；箭头加「下一段：」送去下一段接着做，不是放弃。
     先后就是你排的行序：上下挪一下再 submit；一次只交一条。 -->

<!-- 已关闭 19 段（不再过目）：S02.1 3 · S02.2 12 · S02.3 2 · S02.4 3 · S02.5 2 · S02.6 1 · S02.7 2 · S02.8 2 · S02.9 3 · S02.10 3 · S02.11 4 · S02.12 3 · S02.13 2 · S02.14 1 · S02.15 1 · S02.16 1 · S02.17 1 · S02.18 16 · S02.19 12 -->

## 段 S02.20
<!-- 在做（1 条）：只做这一条，做完立刻勾上，再动下一条 -->
- [ ] T88 让议题卡里的轮次号能点回那一轮原话
  依据：2026-11-24 用户轮「讨论机制按议题来…轮次只做索引、能点回原话」
  标准：deed say "…" --topic I1 只把这一轮的编号追加进该议题，不复制文本；不存在的议题号 exit 1 且一个字不落账；面板议题卡上的号是指向 #turn-N 的锚点、点得到那一轮；cli 与 board 各有用例
<!-- 等着（7 条）：上面那条做完再动 -->
- [ ] T91 清单条目要写明来自哪条议题，没确认的议题不能用
  依据：2026-11-24 用户轮「讨论机制按议题来…冲突拆成题」
  标准：plan 行可带一行 来自：I1；submit 核对议题存在且已放出，否则整批拒并点名第几行；task.add 落 topic；没放出的议题一条都出不来；state 在「有已放出的议题、清单还没条目」时把下一步指向写清单；有用例
- [ ] T93 只有真要出整期审时，state 才提目的
  依据：2026-11-24 用户轮「讨论机制按议题来」后的状态呈现讨论
  标准：单段会话的 state 不印「目的 · 还没有」；多段且要整期审时印成「整期审的尺子 · …」；deed --help 与 DESIGN 里 goal 的说法同步（T81 删掉 goal 动词之后，那句话只指清单第一行）；有用例
- [ ] T140 先后只在任务相对次序变了时才记，完成一条不连累后面
  依据：2026-11-25 用户轮「做任务太慢，第一优先级是效率…机制化地优化」
  标准：真实账本里 task.order 542 条、138 条任务（约四倍）；改成 submit 只比较「还没了结的条目在清单里的相对次序」，次序没变就不落 task.order；依次完成五条以后账本新增的 task.order 为 0（用例盯住事件数），把两条行上下调换再 submit 才各落一条；旧账本照旧读
- [ ] T141 同一份字节不重复跑 --run，submit 认上一次真跑过的结果
  依据：2026-11-25 用户轮「做任务太慢，第一优先级是效率…机制化地优化」
  标准：submit --run 在「自上次记录以来工作区内容没变」时复用那次结果并把它记进交付记录（记着那份结果的来源与工作区指纹），变了就照旧真跑；用例覆盖复用与失效两条路；不得出现「复制来的数字」——复用的是同一份字节上的真跑
- [ ] T137 给六条只有一句话的交付记录补上能当场跑的命令和结果
  依据：2026-11-25 用户轮「开始 19 段的开发…缺乏上下文就查对话记录或直接问我」
  标准：`S02.19` 那六条（T100、T104、T107、T109、T110、T112）的记录里，每条都带一条当场能跑的命令，以及它该印出来的那句话（或一条由 `--run` 采到条数的命令）；清单上不再出现「这条没配命令核过」的批注；剩下的数字与当天跑出来的一致；改完由审查者复核
- [ ] T90 在面板上确认议题后才拆任务，命令行不开放这个动作
  依据：2026-11-24 用户轮「讨论机制按议题来…冲突拆成题」
  标准：面板在「题全关 + 正文非空 + 至少一轮」时显示按钮，其余时候不显示；POST /topic/release 只收 127.0.0.1 且同源，落 {k:"topic.release", by:"user", via:"panel"}；cli/spec.mjs 里没有 topic release 这条，任何 --via 自称都不认；有用例覆盖闸与拒绝
- [ ] T92 面板 /events 的客户端断开后，服务继续运行
  依据：2026-11-24 用户轮「讨论机制按议题来」后的面板稳定性讨论
  标准：board/serve.mjs 的 /events 有 res.on("error") 与写失败处理；客户端连一次再断开之后进程仍活着（探针记 pid 前后一致）；有用例或可复跑的命令
<!-- 已完成（35 条）：交过的，往下沉 -->
- [x] T151 任务只保留标题、标准、依据三样，标准过时会提示
  依据：P14 的判断；用户要求任务能让陌生 agent 独立推进
  标准：task.add 带 problem/source/premise；task.context 可补上下文不改标题标准状态；清单草稿解析与渲染三字段；审查材料与面板显示；core/stale.mjs 机械查过期（只查未做且段开着的任务），deed state 只读提示；老账本照读
  交付：任务条重构落地：task.add 带问题/依据/前提，新增 task.context 事件（EVENT_VERSION 31、package 0.28.0）；清单解析与渲染三字段、审查材料与面板显示；core/stale.mjs 比对命令面查过期，deed state 只读提示（本期抓到 T88 的 say --topic）；老账本照读；期望：node --test => ℹ pass 247
- [x] T80 T80 题：删 --why，resolve/withdraw 变 answer/drop
  标准：deed ask "…" --reading 记下题；deed ask answer A1 --decision --by 与 deed ask drop A1 --why 取代 resolve/withdraw；ask 不收 --why；裁定里的「边界：」「弃：」照旧认；旧动词 exit 1；有用例覆盖
  交付：deed ask answer A1 --decision "…" --by user 落账并关题；deed ask drop A1 --why "…" 关题；ask resolve 与 ask withdraw 两条旧路 exit 1 并指到新名（ask resolve 实测报「已经改成 ask answer A1」）；ask 的开关表里没有 why（给 raise 传 --why 会被拒）；裁定里的「边界：」「弃：」照旧从账本算出来（边界仍 2 条）；事件含义第 26 版：ask.raise 只有 v<26 的旧行才要 why；规则块、README 围栏、AGENTS 尾段三处同一段话已同步；这一份字节上 node --test 217 条（216 过，1 条面板端口用例在并发下红，单跑 test/cli-state1 12/12）（agent）
- [x] T81 T81 收口与免审并进已有动词：review --skip、sign --shelve，删 goal
  标准：deed review --skip --why 封免审段（取代 deed seal）；deed sign --shelve --why 归档（取代 shelve）；deed goal 删除（目的来自清单第一行，submit 已落 goal.set）；三个旧动词 exit 1；有用例覆盖
  交付：deed review --segment S02.20 --skip --why "…" 落 segment.seal（cli-review1/2 与 rules 的用例都走这条路）；deed sign --shelve --why "…" 落 shelve，不带 --shelve 时仍只回「去面板上按」；deed goal 删除，目的写在清单第一行、submit 落 goal.set（cli-state1 的用例改成改第一行再 submit）；三个旧动词 exit 1 并指到新名（seal→deed review --segment S1.1 --skip --why，shelve→deed sign --shelve --why，goal→清单第一行）；deed help 按「讨论/执行/验收/管理」四组打印（cli/spec.mjs 的 GROUPS 是唯一来源，ORDER 由它摊平）；say 的 --by 删掉；这一份字节上 node --test 219/219（agent）
- [x] T83 T83 删掉旧命令：cli/verbs/task.mjs 真删除，测试改走清单+submit
  标准：cli/spec.mjs 与 ORDER 里不再有 task；cli/verbs/task.mjs 删除；test/cli.test.mjs 里 163 处 task add/done/undo/defer/drop 的夹具改走 deed plan + deed submit（或集中在一处替身里翻译），并有用例断言旧动词 exit 1；全量绿
  交付：命令面收敛收尾：cli/verbs/task.mjs 已删除，cli/spec.mjs 的 SPEC 与 GROUPS 里不再有 task，敲它 exit 1 并指到 deed plan／deed submit；test 里 84 处 deed task 调用改走清单+submit（cli-review1 27、cli-review2 57），board 的闸夹具与 cli-due／cli-state2 一并换掉；submit 对「已交付条目再勾一次」不再静默跳过——冻结的段说在审／等你判决，没冻的说先取消勾选写理由；期望：node --test => ℹ pass 230
- [x] T87 议题是账本上的对象：立项、追加正文、折得出状态
  标准：deed topic "标题" --body "…" 自开号 I1、I2（与题的 A、清单条目的 T 不撞）；再次 deed topic I1 --body "…" 追加正文；core/fold.mjs 折出 topics（id/title/body/轮次索引/状态）；不复制任何轮次正文；EVENT_VERSION 升 1 且旧账本照读；有用例覆盖立项、追加、空标题被拒
  交付：议题是账本上的对象：deed topic "标题" 自开 I1，同 id 再 deed topic I1 --body 追加正文；fold 折出 topics；空标题被拒；期望：node --test test/discussion.test.mjs => ℹ pass 8
- [x] T101 审查结论按条落下：判过的条目下一轮不再重判
  标准：review.log 带 results:[{id, verdict, note}]，一条条目一个判定（达成／未达成／无法判断）；pass 只在段里每条条目都有判定时才封段，缺哪条就拒并说出号；重审的清单只列「还没判过」与「自上次判定以来字节变过」的条目，其余条目的判定沿用；旧账本里没有 results 的结论照读（按整段 pass／fail）；有用例（判过 T1 之后改 T2，重审清单只列 T2，pass 之后 T1 的旧判定仍算数）
  交付：跑：node --test 215/215（test/cli.test.mjs 的 a verdict is per item…、test/fold.test.mjs 的 pass 覆盖一条）；review.log 带 results:[{id,verdict,note,files}]，fold 在 meaning>=19 时要求 pass 覆盖这一段每条、否则拒并点名；清单只列没判过的与字节变过的（cli/brief.mjs 的 still/again），已判的印成「判过了、这次不再判」；旧行没有 results 照读
- [x] T113 预备段里写「改到下一段」真的挪出去，一段才切得动
  标准：从预备段里改出去时开一个新预备段并把它挪进去，源段的 carried 置 false（它不再接新活，只等结论）；那一段一条都没交过时当场拒并说清怎么办；旧行按它写的时候那套含义读（EVENT_VERSION 14 / MEANING.carryOut）；有用例覆盖这三件事，且去掉其中任一判断会让对应的一条红
  交付：安装文档里的命令与今天一致（T125 之后 reint 了段的行话）。
- [x] T114 记账之后核一遍刚落下的交付：指得到那份内容、不是空交付，核过要印一行
  标准：落账后把刚写进账本的每条交付再核一遍：路径指得到当时那份内容、且不是空交付；对不上或空交付就打印并 exit 1；核过时印「落账后核对 · N 条都对得上当时那份内容」；用例直接驱动这个核对（记下 a.md 是一份内容、盘上已换成另一份 → 报出来；空交付 → 报出来），另有 submit 的用例盯住那一行（删掉这一步立刻红）
  交付：文档用词用例：禁词表与三份规则块的逐字一致。
- [x] T116 落账那一刻自查：刚落的钉当场就旧、或数当场对不上，就地报出来
  标准：交付时对每个路径取两次 sha（量差前与落账后），不一致就拒；落账后立刻跑一遍 verify 的核对，若刚落的钉当场过期或空交付，当场打印并 exit 1，不等审查者；有用例（落账前手改文件 → 被拒；正常交付 → exit 0 且不报）
  交付：跑：node --test 209/209（跑在这份字节上）；这条接 T107——放弃理由被第 4 份清单推翻：cli/verbs/submit.mjs:230-252 记账后跑 cli/pins.mjs 的 auditDelivered（指不到那份内容或空交付就 exit 1），test/cli.test.mjs:2397-2408 驱动两种情形、:1623 盯住「记账之后核对 · 1 条都对得上当时那份内容」；量差之后写入之前那一次仍由 requireUnchanged 真拒
- [x] T117 放弃撤不回：错撤的条目要能回到交付
  标准：放弃过（task.drop）的条目能撤回那条放弃并回到未做，从而重新交付——`deed task undo T<号>` 承认的是最后一条（放弃也是一条），账本只追加，撤的是效力不是记录；没有可撤的放弃就拒并说清；state、面板与清单里看得出这条「放弃过、又回来了」；有用例（放弃 → 撤回 → 能再交付并出现在清单上；撤一条从未放弃的 → 拒）；旧账本里的放弃照读
  交付：跑：node --test 213/213（其中 test/fold.test.mjs 35 条、test/cli.test.mjs 119 条，两条新用例在 fold 与 cli 里）；core/fold.mjs:283-291 的 task.undo 落在放弃/延后上时把任务放回未做、revived 记下走过这一遭，cli/verbs/submit.mjs 允许把 ~~ 改回 - [ ] 并在缺 理由： 时拒；清单印「撤回过的放弃」、deed state 印「（撤回过放弃）」、面板挂同一句；变异：把 fold 那一支改成 if(false) → fold 一条红，把 submit 的 if(!item.why) 改成 if(false) → cli 那条红
- [x] T118 角色包写清审查者怎么动手：要在副本上做实验，仓库里一个字节都不动
  标准：角色包把「你不能改代码」那一节换成「你怎么动手」——可以跑任何命令、造夹具、把整个工作区复制到仓库外做破坏性实验与变异（改一处判断 → 跑对应用例 → 看它是否真红），仓库内零改动；不能提交、不能改账本与正在审的两份材料、不能替作者修；每条结论与发现都要配复现路径（命令 + 实际输出，或 文件:行）；有用例盯住这几句话在角色包里（少一句就红）
  交付：跑：node --test test/docs.test.mjs 6/6 与 node --test 215/215（跑在这一份字节上）；cli/brief.mjs 的 guideText 是「你怎么动手」：临时区 .deed/tmp/<段>-<时间戳>/ 里造夹具、复制工作区、改一处判断看用例是否真红；仓库零改动、不改账本、不替作者修；临时区随结论落地删除（cli/verbs/review.mjs 的 rmSync）
- [x] T119 done 之前先算段内那一步：待裁不再劫持「下一步」
  标准：`deed state` 的下一步先算这一段此刻真能动的那一步（还有没做的条目 → 交付；结论旧了或不合格 → 重审或落结论；段关着 → 整期审或签收），这些都轮不上时才轮到待裁；有待裁项时 state 仍单列「待裁」不消失；有用例（开着一条待裁、同时段里还有未做条目 → 下一步是交付；待裁与一切就绪同时存在 → 下一步是审批/签收，待裁仍印出来）
  交付：跑：node --test 215/215（board/board.test.mjs 的 the page names the next actor… 盯着「段里还有该做的事时，下一步不是待裁」，cli 的 state 用例跟着走）；core/rules.mjs 的 nextAction 先算冻结→段内交付／记下文件／审与落结论，待裁排在这些之后、仍单列
- [x] T120 发现是主张不是判决：可 fix / defer / reject，结论只判标准
  标准：每条发现落账时带处置与依据——fix（已改，指到改在哪）／defer（登记成条目，说清为什么不在这轮做）／reject（不认，给依据）；账本里读得出曾经打过哪条、作者怎么回的；下一次出清单时，上一份里还没被回答的发现要印在材料上，等审查者回答那条反驳；段结论只判「标准在这一份字节上成立不成立」，不因为「作者没照建议做」单独判不合格（除非那条事实使标准不成立）；有用例（reject 一条并给依据 → 账本可读、下一份清单印出那条反驳；只写形容词的 reject 被拒）
  交付：清单与命令面：plan 只写一份（删 --print/--format/--force）；草稿只画目的+当前段+排队段+预备段，已关闭段收成一行（本仓 452→176 行）；记号收成一种形状（[?] / [ ] / [x] / [~]，注记一律 → 开头）；submit 记账后按账本重画草稿；被拒的每一次在 .deed/tmp/refusals.log 留一行；期望：node --test => ℹ pass 235
- [x] T121 清单的行序就是做事的顺序：条目在文件里排在哪，就按那个次序印
  标准：位置按条目在它那一节里的第几行算，submit 落一条 task.order（段内算、不跨段）；deed state 的下一步、deed plan --print、面板三处读同一个次序（core/rules.mjs 的 byOrder），不再按条目编号排；已封存的段里的条目不被事后重排；把某一块行上下挪一下再 submit，账本只多出 task.order 那一类事件、标题与标准一个字不动；有用例（挪完之后三处次序一致、下一步指到新的第一条；把 tasksIn 改回原始顺序，那一条红）
  交付：按 T125 之后的字节重记（原记录在同一条任务的撤销里）：内容没变，钉的字节跟着变。
- [x] T122 撤回一条「改到下一段」，走空的段跟着消失
  标准：`deed task undo T<号> --why "…"` 能撤回一条 carry——条目回到它原来那一段，那一段重新成为预备段；被走空的那一段从段列表里消失（段由条目生出来，不是计划）；撤销一条从未挪过的条目仍被拒并说清；有用例（挪出去再撤回来，段列表只剩一条；把删段那一行改掉，那一条红）
  交付：跑：node --test test/fold.test.mjs 37/37（两条新用例：撤回之后段列表只剩一条、没撤过可撤的仍被拒）；core/fold.mjs 的 task.undo 在条目还没交过、站在最末一段时把它送回上一段，把那一段的 carried 置回 true，并把走空的那一段从重放结果里删掉；变异：把删段那一行改成 void left → 那一条红
- [x] T123 清单没被回答之前这一段冻结：要么审，要么撤回清单再改
  标准：一份清单发出去、还没被回答的这段时间，这一段是冻结的——`deed submit` 拒收这一段的任何改动（新条目、交付、撤回、放弃），并说清三条出路（落结论／撤回清单／把改动交到下一段）；新活落进下一段而不是这一段；`deed review --segment S0x.N --withdraw --why "…"` 把这份清单撤回并作废（记一条 review.withdraw），段回到执行态、可以继续改；落结论时逐条核清单上每条的交付记录与今天的字节，变了就拒并点名哪一条，指到撤回清单或落进下一段；旧账本照读；有用例覆盖上面每一条（去掉冻结那一条判断即红）
  交付：按 T125 之后的字节重记（原记录在同一条任务的撤销里）：内容没变，钉的字节跟着变。
- [x] T124 用户只有三个闸，且都在面板上：议题通过、判决通过、签收通过
  标准：命令行不再提供这三条路——`deed sign`、`deed judge --overturn`、`deed topic release` 都 exit 1 并指到面板；面板上只有满足条件时才出现对应按钮（议题题全关＋正文非空；判决：有在案结论可推翻；签收：每段都有结局且无未做／未判／待裁），点了才落账、带 by 与 via:"panel"；账本里读得出是谁、在哪按的；三条闸各有用例（命令行被拒、条件不满足时不出按钮、点了才多出一行事件）
  交付：签收闸：面板验收屏写原话按「签收这一期」，落 sign（by user、via panel）；命令行 deed sign 只回一句指到面板。T125 之后字节变了（board/render.mjs 加排队段），按今天的字节重记。
- [x] T125 段可以在清单里预先排：多段一次写出，按行序依次开段，只有当前段收活
  标准：清单里写多个 `## 段`，submit 按行序把条目归到各段（不是一律塞进当前开段）；同一时刻只有一段收活，前一段有结局后下一段才开；`deed plan --print` 与 state 显示各段处于哪一步；没预排的清单行为不变（条目仍落当前开段）；有用例覆盖两段预排、依次开、前面没结局时后面不开
  交付：跑：node --test 223/223（全量）；core/events.mjs 含义第 24 版加 segment.plan（空标题的一节 submit 领号）；core/fold.mjs 的 task.add 认 segment（落在清单排好的段里），nextSegment 按已有最大号 +1 编号（旧账本重放仍落同一段），task.carry 第 24 版起目标是「下一个还没关闭的段」，没有就拒（先在清单里加一节），旧行按当时那套读（含自己开段的旧读法）——预备段这个概念删了；core/rules.mjs 加 takingSegment（收活的那一段＝队列里第一个非清单排出来的未关闭段）与 queuedSegments；cli/plan.mjs 的 parse 收 sections 与 sectionTitle，draft 对排队段多印一行注释；cli/verbs/submit.mjs 按节映射段（段号写了就用、空标题领号、同批递增防重号）、先把段声明在条目前面落账、给排队段勾交付整批拒；cli/session.mjs 与 cli/verbs/review.mjs、seal.mjs 对排队段的交付/送审/封存当场拒并说清现在收活的是哪一段；board/render.mjs 排队段挂「等前面」（验收屏与执行屏）并按 takingSegment 判当前段；deed state 同时印出排队段与收活段。用例：test/fold.test.mjs 39/39（改到下一段落进清单排好的段、没有下一段当场拒、旧行照旧读）、test/plan.test.mjs 与 rules 72/72、test/cli.test.mjs 121/121 里 the plan can line up several segments, and only the first takes work 与 an entry still to be done is carried to the next segment from the plan。
- [x] T126 送审即冻结只挡交付与撤回交付：记录层面的照旧，落结论不比字节
  标准：清单发出去、还没被回答的这段时间，这一段拒收交付与撤回一条交付（新活落进下一段）；记轮次、写题、延后、放弃、改到下一段照收，它们是决定不是文件；`deed review --segment S0x.N --withdraw --why "…"` 是唯一出路，撤回后这一段回到执行态、可以继续改，旧清单记一条 review.withdraw 并留下撤回的人与理由；落结论前只问交付记录有没有指到工作区外面，不再比字节——盘上被别的进程改了是 `deed verify` 该报的账；有用例（交付与撤回交付被拒并说清出路、tick／ask／drop／carry 放行、撤回要 --by、字节变了 verdict 仍落得下来）
  交付：测试夹具与公共步骤：test/cli.test.mjs 拆成 test/cli-review1/2、work1/2、state1/2、rules1/2 八个文件，公共步骤在 test/support/cli.mjs（15 个具名导出）；拆的时候一条断言没改。
- [x] T127 一段结束后段审，全段结束后期审，签收在期审之后
  标准：`deed review --segment S0x.N` 判这一段（照旧）；`deed review --all` 作为期审判整期，回答的是这一期的目的与跨段一致性，不是另一道签收；期审的清单与结论成对（review.brief 与 review.log 记 scope:"session"），旧账本里早先的 session 结论仍只作历史、不挡签收；每一段都有结局、无未做、无已交付未判之后才出期审清单，期审 pass 才轮到签收，fail 点名哪一段就重开那一段；`deed state` 在段全关之后先给「出期审清单／落期审结论」，面板同步；EVENT_VERSION 升 1、旧行照读；有用例（段没关全不出发期审清单；期审 pass 之后签收可行；期审 fail 点名一段则那一段重新打开）
  交付：deed review --all 以期审的身份回来：清单与角色包由 cli/brief.mjs 的 planWhole 生成，列目的、各段结局、这一期定下的边界与弃、还挂着的东西，不列段里的条目；core/rules.mjs 的 needsPeriodReview／periodState／stalePeriod／periodFresh／periodReviewers／segmentReviewers 说得出现在这一步；signBlockers 多一条「这一期的期审没通过」，nextAction 在段全关之后先给期审，写清换一双手；期审 pass 才轮到签收，fail 点名段号则那一段重新打开、条目保持交付（core/fold.mjs 的 session-scope fail 分支）；EVENT_VERSION 20 / MEANING.periodReview，更早的 session 结论只作历史、不挡签收。全量 219/219 跑在这一份字节上（另一次运行由 --run 采）；变异：把 signBlockers 里期审那道门注掉 → rules 两条用例红（0 过 2 败）
- [x] T128 一段发过多份清单时，只有最后那份算还在等结论
  标准：`awaitingVerdict` 只看这一段手上的最后一份清单（scope:segment 的最后一条 review.brief）；前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；再出一份、被回答之后这一段回到执行态，冻结算的是同一句；旧账本照读；有用例（同一段发过两份、第一份没人回答、第二份被判 → 段不再等结论、新活落回这一段；把判断改回「有任何一份没被回答」即红）
  交付：core/fold.mjs:98-105 的 awaitingVerdict 只看这一段最后那一份清单：前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；冻结算的是同一句；新增 test/fold.test.mjs 的 a second brief supersedes the first one nobody answered，变异把判断改回 some 时那条红（fold 37 过 1 败），还原后 fold 38/38；这一条走 task done，全量 216/216 是同一份字节上跑过的，但没被 --run 采进账本
- [x] T129 冻结只拦写：账本里已经落下的行一律照读，重放不因这一段后来送了审就判它坏账
  标准：冻结的拒绝发生在落盘前一刻（cli/session.mjs 的 refuseFrozen：task.done 与「撤回一条已交付」两类事件），core/fold.mjs 不再为冻结抛错；一份没人回答的清单出现在某条交付之后，整本账仍能重放、面板仍出正常页；交付与撤回交付在写的一侧仍被真拒并说清出路；有用例（重放含「清单已发出＋之后又落一条交付」的账本不抛；把判断加回 fold 即红）
  交付：跑：node --test 217/217（全量，数由 --run 采）；core/fold.mjs 的 task.done／task.undo／task.order 三处不再为冻结抛错，改由 cli/session.mjs 的 refuseFrozen 在落盘前一刻拦（task.done 与「撤回一条已交付」两类），措辞与原来一致；新增 test/fold.test.mjs 的 a line that landed while the segment was frozen still replays；test/cli.test.mjs 的 a frozen segment refuses… 仍红着盯住写的一侧；面板重启后 7317 出的是正常页（461349 字节）
- [x] T130 记账之前那一次核对，收据由核对的函数自己印：接线掉了用例就红
  标准：`requireUnchanged` 核过时自己印「记账之前再核一遍 · N 条没有变」，调用处不再另印一句（印在调用处的收据只能证明调用处那行还在，证明不了核对真跑过）；`deed submit` 与 `deed task done` 两条路都有 CLI 用例盯住这一行；把两处 `requireUnchanged(ROOT, pins)` 任意一处注掉，对应用例当场红；有用例覆盖（本段实测：注掉两处后 one delivery pins every file 与 a plan lands as one batch 两条都红）
  交付：cli/pins.mjs 的 requireUnchanged 核过时自己印「记账之前再核一遍 · N 条没有变」，cli/verbs/submit.mjs 与 cli/verbs/task.mjs 不再另印一句；test/cli.test.mjs 的 one delivery pins every file 与 a plan lands as one batch 各加一条断言；变异：把两处 requireUnchanged(ROOT, pins) 注掉 → 那两条用例 0 过 2 败，还原后两条都绿。全量 217/217 跑过但这一批没量到改动、没被 --run 采进账本
- [x] T133 免审的段不出清单：没人要答的卷子不进账本
  标准：`deed review --segment S0x.N` 出清单之前先算 `needsReview`；算下来不用审就打印「审查设置说这一段不用审」，不写账本、不生成清单与角色包，下一步指到 `deed seal`；要审时照旧出两份；有用例（免审段调用之后账本没有新的 `review.brief`，`.deed/review` 下没有新文件）
  交付：cli/verbs/review.mjs 出清单之前先算 needsReview，算下来不用审就印「审查设置说这一段不用审（改动都落在免审路径）：不出清单与角色包，账本也不记一条等人回答的清单」并把下一步指到 deed seal；test/cli.test.mjs 的 a segment the settings exempt gets no brief, and the step says to close it 盯着账本没有新的 review.brief、.deed/review 里没有新文件。全量 219/219 跑在同一份字节上（另一次由 --run 采进账本）
- [x] T134 三个屏都从新往旧排：最新的在最上面
  标准：讨论屏的轮次、执行屏的段与条目、验收屏的签收差，全部按账本里发生的先后倒过来印——最新的在最上面，最早的沉到最后；同一屏里不混着两种次序；面板真开一次看，最新的一条不在需要往下翻的位置；有用例（造三条先后发生的记录，印出来最上面的是最后发生的那条）
  交付：三屏倒序：最新的在最上面（段与条目都倒过来）。
- [x] T135 清单按状态分三段：正在做的、还没做的、已经了结的
  标准：清单与 `deed plan --print` 里，每一段的条目按「在做（最多一条）→ 等着（按行序）→ 已完成 → 撤回／放弃」排，各组之间空一行并各写一句小标题；已完成的排在新待办之后，撤回与放弃的排在已完成之后；面板上的次序与此相同；有用例（同一段里三种状态的条目，印出来的次序固定；把一条已完成的挪回待办前面就红）
  交付：清单按四组印（在做→等着→已完成→撤回或放弃），面板段里挂同样的小标题。T125 之后 cli/plan.test 与 submit 的字节变了，按今天的字节重记。
- [x] T136 一次只交一条：一批落下好几条交付不再收
  标准：`deed submit` 一次落下的交付多于一条就整批拒，并说清「先交此刻那一条，做完再交下一条」；勾一条照旧；旧账本里同批的旧记录照读（批号那几格不动）；清单上标出「在做」的那一条，其余待办标成等着；有用例（一次勾两条 → 拒且账本零新增；勾一条 → 成）
  交付：一次只交一条：submit 勾了两条以上整批拒，账本零新增。T125 之后 submit 改了落段的写法，按今天的字节重记。
- [x] T138 判决是审查通过之后用户按的第二道闸：段由判决关闭，签收按期
  标准：审查者的 pass 只把这一段交回来（segment.verdict="pass"、reviewedAt/reviewedBy，closedAt 仍为空），这一段不再收新活、交付与撤回交付照样冻结；用户只在面板上按「判决通过」（落 verdict.pass，带 by 与 via:"panel"），按下之后这一段才关闭、段内已交付转 accepted；没有审查通过时限不了判决、判过的段不能重判；签收等每一段都有结局（判决或 seal）、无未做/未判/待裁、期审通过；deed state 在审查通过后给的下一步是 user·判决，面板在等判决的段上出那个按钮；旧账本里 pass 即关闭的行按旧含义读；三条用例（审查未通过判不了、pass 之后签收仍被挡且交付被冻、判决之后段关闭并可签收）
  交付：判决是审查通过之后用户按的第二道闸（含义第 23 版）；T125 改了状态的印法，按今天的字节重记。
- [x] T139 拆开最慢的那个测试文件，让每一轮验证从两分半降到一分钟
  标准：test/cli.test.mjs（154 秒，占全量 98%）按主题拆成若干文件并抽公共步骤到 test/support/cli.mjs；node --test 的用例总数与拆分前一致（121 条），单条断言不变；`node --test` 的实际耗时降到原来的 40% 以下（同一台机器、同一份字节），package.json 加 `test:fast`（core+board+docs，1 秒级）
  交付：跑：node --test 224/224（全量，同一份字节；拆完之后全量 63.8 秒，拆之前单文件 test/cli.test.mjs 一条就 154.1 秒）；test/cli.test.mjs 按主题拆成八个（review1/2、work1/2、state1/2、rules1/2，共 121 条，一条不少），公共步骤抽到 test/support/cli.mjs（CLI、OFF、deed、later、gate、judgeAll、judgeHere、signHere、judged、kinds、briefs、proof、writeLines、planFile、writePlan、readPlan 共 15 个具名导出，从 test/ 里 import 一个就够）；每条用例的断言一句没动——拆分只挪行；package.json 加 test:fast（fold+rules+plan+docs+board，1.5 秒）与原有的 test（node --test）。量：拆前 $t=154.1s（test/cli.test.mjs 单跑），拆成四文件 71.7s，八文件 62.7s；全量 223→224 条、63.8s。
- [x] T143 把不对的机制删掉：账本不对字节、清单每份列全部、去掉「先做后记」与每段花了多少
  标准：cli/audit.mjs 与 deed verify 动词删除（cli/spec.mjs、cli/deed.mjs 里不再有），$digest 开关不再收；交付记录只记路径与字节数（evidence.files=[{path}]、changed、bytes），清单只记两份路径（review.brief 的 brief/guide），都不带 sha256 或内容指纹；送审冻结仍然挡住「这一段的活在被审期间被改动」；清单每份列全部条目（没有「判过了、这次不再重判」一节）；「先做后记」（lateWork）与 costOf 及 state/面板上的「花了 · N 份清单」都删除；doc/README/DESIGN/HANDOFF/规则块与代码同一口径；删掉的机制对应的用例一并删除，留下的用例全绿
  交付：node --test 203/203（全量，含 board/docs/fold/plan/rules 与八个 cli 文件）；cli/audit.mjs 与 cli/verbs/verify.mjs 删除，SPEC 与 commands 里不再有 verify，--digest 拒收（`deed task --help` 的开关表里只剩 --evidence/--files/--by/--why）；交付记录只留 files:[{path}] + changed + bytes，review.brief 只留两份路径；送审冻结照旧（在审的那一段交付被拒）；清单每份列全部条目；lateWork 与 costOf 删除，state 与面板不再印「花了」；README/DESIGN/HANDOFF/AGENTS 与 lib/words.mjs 的规则块同一口径（test/docs.test.mjs 6/6 逐字比对通过）
- [x] T144 体检层：这个工作区还是不是一个项目，用一张有序的检查表算出来
  标准：core/checks.mjs 是纯函数（账本 + 目录快照 → 逐条结论），CHECKS 有序、每行登记"事实/判定/修法/能力"；三种结论 pass/fail/na，未声明项目时项目级检查一律 na 且不算未结项；projectState 给 declared/shape/passed/total/missing 且会随树走样退回去；project.declare 事件（含义 25）进账本，认可不落盘；deed check 只读、exit 0、逐条印结论与修法；deed state 顶上印"项目 · 形态 · k/n"或"没有声明（工作区模式）"；未通过不挡三种状态；既有用例全绿
  交付：node --test 212/212（全量，含新 test/checks.test.mjs 8 条与 cli-state2 的 standing 用例）；core/checks.mjs 的 CHECKS 三行（工作区/树/背景）各有 事实·判定·修法·能力 四样，checkAll/projectState 不读盘不读钟；lib/tree.mjs 只提供目录与相对 import；deed check 只读、未通过也 exit 0，逐条印 ✓/✗/— 与修法；deed state 顶上那行随说了算的账本变（本仓已声明 software，4 层方向都对，3/3）；project.declare 是含义第 25 版的事件，package 0.22.0；DESIGN §13、README 命令表与事件表、规则块三份同步
- [x] T145 结构检查对着范式判格：必需格、目录归属、extras 豁免
  标准：core/checks.mjs 有 PARADIGM（software/document/data/work/free）；结构检查四步：范式要求的格都在、声明的目录都在盘上、盘上每个顶层目录都有归属（认领或 extras）、跨格方向按 mayImport；layers 写 role=dir，role 缺省取 dir；project.declare 收 role 与 extras；deed project 支持 --extras；缺格/无归属/方向反三种失败各有具体 detail 与修法；本仓声明 tests=test、extras=docs,examples,support 后 3/3；沿用三种状态的语义，未通过不挡任何动作
  交付：node --test 215/215（全量；checks 11 条含缺格、无归属目录、extras 豁免、目录名与格名不同）；npm run test:fast 103/103；本仓重新声明 --layers "core=core:,lib=lib:core,app=cli:core+lib+board,board=board:core+lib,tests=test:core+lib+app+board" --extras "docs,examples,support" → deed check 3/3（5 个目录认领 5 格，方向都对）；顺手删掉仓根一个误建的 %SystemDrive% 目录（正是「无归属目录」那种野地）
- [x] T146 T79b 一轮只记一句话：deed 说一句话就记下这一轮（say 取代 tick）
  标准：deed say "…" 记下这一轮，said 是位置参数；没有 --said、--did，也没有 --who（轮次只认 user，agent 的进展写交付记录或结论）；tick 这个名字从开关表、帮助与文档里消失，敲它 exit 1 并指到 deed say；state 与面板不读 did；有用例覆盖（tick 被拒且指路、say 落账、state 打印这一轮）
  交付：deed say "我改了三处" 落账为一条轮次（said 是位置参数，报告「已记一轮」）；deed say "…" --who user 被拒（不认 --who）；deed say "…" --said x 被拒（不认 --said）；deed tick "…" exit 1 并指到 deed say（cli/deed.mjs 的 MOVED 表）；帮助与开关表里 tick 0 处；state 只印原文，不读 did；这一份字节上 node --test 218/218（agent）
- [x] T148 T82b 一个体检入口：账本与门并进 deed check（doctor、gate 下线）
  标准：deed check --ledger 逐行校验账本并可重放，坏账报哪一行哪一条、退出码 1，账本比程序新时说升级而不是坏账；deed check --gates [名字…] 按账本里 gates 的顺序跑，第一条不过就停、报名字与退出码，没有门时说清怎么写；deed check 不带开关仍只打项目状态并退出码 0；doctor 与 gate 两个动词删除，敲它们 exit 1 并指到 --ledger / --gates；有用例覆盖
  交付：deed check --ledger 逐行读、逐行重放（cli/ledger.mjs 的 checkLedger）：干净时印「账本干净 · 1488 条事件都能重放」与接入/心跳两行；坏账报「账本坏了 · 文件名 第 N 行」并给唯一允许的修法，退出码 1；账本比程序新时印「账本比 deed 新」与升级指引而不是坏账；deed check --gates 按 gates 顺序跑（没有门时印「这个工作区没有门」并给一行 config 写法），第一条不过就停；deed check 不带开关仍只打项目状态（本仓 2/3）、退出码 0；doctor 与 gate 两个动词删除，敲它们 exit 1 并指到 --ledger / --gates（cli/deed.mjs 的 MOVED）；面板顶部与帮助页的指路、INSTALL/DESIGN/research 同步；这一份字节上 node --test 219/219（agent）
- [x] T150 观察层：命令面自己怎么被用——从没敲过的、敲了就失败的、没人用的开关
  标准：每次调用在 .deed/debug/*.jsonl 留一行（动词、成没成、耗时、开关名、被拒的那一句），不进账本也不进方案快照；deed debug [--days N] [--json] 印三节：从没敲过、敲了就失败最多、一次没用过的开关；样本不足时报告自己说出来；有用例覆盖一行一调用、开关只记名不记值、窗口只认窗口内的、报告与 --json 的字段
  交付：观察层落地：cli/trace.mjs 一处写（dispatcher 收尾：动词、ok、ms、开关名、被拒的那一句），cli/verbs/debug.mjs 一处读（从没敲过 / 敲了就失败最多 / 没人用过的开关 / 拒绝的话按次数 / 最慢的 p95），--json 给机器；trace 不建 .deed、不进快照、不进账本；顺带删掉 init 里早该没有的 --who；期望：node --test => ℹ pass 239
<!-- 撤回或放弃（14 条）：不做了的，沉到最后 -->
- [~] T79 T79 一轮只记一句话：deed say 取代 tick
  标准：deed say "…" 记下这一轮（--who 默认 agent，可写 user）；said 是位置参数，不再有 --said、--did；tick 这个名字从开关表与帮助里消失；state 与面板不读 did；有用例覆盖（旧动词被拒、say 落账、state 打印该轮）
  理由：标准里写的「--who 默认 agent，可写 user」和后来的口径冲突——轮次只认 user（agent 自己的进展写交付记录或结论）。工作照做，另开 T79b 用对的标准交。
- [~] T82 T82 视图与推翻：state --check/--gates，judge 变 overturn
  标准：deed state 带 --check 时跑核交付与体检（取代 verify、doctor），带 --gates 时跑门检查（取代 gate）；deed overturn R1 --why 取代 judge --overturn；旧动词 exit 1；有用例覆盖
  理由：标准写的是「state 带 --check 跑体检、带 --gates 跑门」，可体检已经有自己的动词 deed check；照这条做等于同一个入口造两份。另外 judge 变 overturn 你早前已经定下不做（结论不归人改）。工作并入 check，另开 T82b 用对的标准交。
- [~] T89 题长在议题里：谈成之后并进正文，题塌成一行历史
  标准：deed ask "…" --reading "…" --topic I1 把题挂在议题下；deed ask answer 同一条命令追加 topic.merge（这条决策进议题正文，题留 id 与关闭时刻）；面板上题不单独立卡，摆在议题卡内部；题全关时议题状态是「都说定了」；有用例覆盖
  理由：标准写在已经下线的概念上：deed ask 与「题」在 6328b5b 整条删除（askRetired，含义第 28 版），现在只有要点与议题；要表达的意思已由 topic.create/establish/release 承担
- [~] T94 有清单的段不再收新条目：送审之后新活开下一段
  标准：一段一旦发过清单，就不再接收新条目（后来加的活开下一段，段号自己往上走）；在案的那份清单不因后来加的条目而作废，只有这一段自己被动过（撤回、改写）才算旧；state 在段等结论时先给「落结论」而不是「写新条目」；整期审打回一段只重开那一段，点名的条目回未做、其余保持交付，之后新加的活仍开下一段；有用例覆盖上面四条，把 core/fold.mjs 的这条判断改回去就红
  理由：并入 T123：冻结不只是「不收新条目」，清单没被回答之前连交付与撤回也不能动，还要有撤回清单这条路
- [~] T97 整期审的范围在发出那一刻固定：预备段里后来的活不让它过期
  标准：整期结论的过期只看它发出那一刻已经存在的段；之后预备段里新加的任务、新的交付不让它过期；被点名退回的段重新打开时它照旧过期；有用的用例（发出整期清单之后在下一段加一条任务并交付，整期结论仍算数）
  理由：整期审这一层已经删掉（m21694）：它说的对象不存在了；「范围在发出那一刻固定」这件事由 T101（按条结论）与 T123（冻结）承接
- [~] T98 打回的返工只重开被点名的条目，其余交付不重判
  标准：review fail 之后只有 --rework 点到的条目回到未做；段里其余已交付条目保持、不复位；重审的那份清单只写被点名与之后改动的条目；有用例（fail 点名 T1 之后 T2 仍是已交付，清单里不再出现 T2）
  理由：与 T101 是同一件事：按条结论一落，打回自然只重开被点名的条目；T98 降为 T101 的一条验收，不再单独登记
- [~] T99 段能在规划时拆成子段：逐个子段审，全部审完再对整段审一次
  标准：清单里能把一段写成若干子段（各带自己的标准与条目）；deed review 只回答一个子段，结论落在子段上；子段全有结论之后才轮到整段的结论；state 与面板显示子段进度；没拆子段的段行为不变；有用例覆盖拆、逐个子段审、整段结论在子段齐了之后才可落
  理由：段现在就是那层拆分单位（m22243）：一段结束后段审、全段结束后期审；再往下拆一层由 T125（清单里预先排多段、按行序依次开段）承接，标准写在那里
- [~] T102 清单指纹按条目算：改一条不连坐整段
  标准：review.brief 的指纹按条目的现行交付算（每条目自己的 files 与 digest），不再用一个整段打包哈希；改一条条目的字节只让那一条的判定作废，其余条目的判定仍算数；清单与账本里看得出是哪一条变了；有用例（改一条的文件，另几条的判定仍可复用，清单只把改了的那条列为变动）
  理由：按你的判断撤：清单层再记一份按条指纹，是交付记录已有事实（files + sha256）的第二份抄写；「改一条不连坐」由 T101 的按条结论判定，不需要清单层再算一遍
- [~] T115 出清单之前先核一遍：这段材料在今天的字节上成立吗，过不了就不出卷
  标准：deed review --segment 出清单之前先跑与落结论同一个核对（auditSegment 那一遍）；这一段有任何交付记录过期或指到工作区外面，就不生成清单与角色包、不写账本，打印是哪一条、记下哪份内容、现在是什么，并把下一步指到重新交付；成立时才照旧出卷；有用例（交一条、改那份文件、再出清单 → 拒、.deed/review 下没有新文件、账本没有新的 review.brief；不改 → 照旧出）
  理由：这条写的是「出清单前先核」，说的是手段不是要解决的问题；真正的问题只有一个——清单发出去之后这一段还在被改（m21966），改由 T123 用「送审即冻结」承接
- [~] T131 这一段自己的交付记录不许是「只是说法」：六条按今天的字节重交，数由 --run 采
  标准：`S02.19` 的清单上不再有「只是说法：这条没配命令核过」；`T100`／`T104`／`T107`／`T109`／`T110`／`T112` 六条撤回后按当天字节重交，记录里的数与 `--run` 采到的一致；清单上那三个 207/207 不再出现在现行交付里；重出清单后由审查者复核
  理由：标准里那句「只是说法」只有我们自己看得懂，别人读到不知道自己该做什么；换成白话重登一条（T137），事情本身照旧要做
- [~] T132 段审一直用同一双手：清单写明交给谁，结论由他落；只有人推翻过的段才换手
  标准：`deed review --segment S0x.N` 出清单时必须写清交给谁（`review.brief.by`），交给的人由清单本身记住；这一段的清单此后都写同一个人，换一个名字出清单或落结论都被拒并说清出路（先由人 `deed judge --overturn` 推翻那一段的结论）；人推翻过之后允许换手；角色包里写明「这一段一直由同一个人判」与这是第几份；`deed state` 印的审清单命令带着那一双手；期审相反，每次都换一双手（判过段的人不判这一期）；有用例覆盖（换人出清单被拒、换人落结论被拒、推翻之后允许换、期审拒同一双手、下一步的命令带 `--by`）
  交付：跑：node --test 219/219（全量，数由 --run 采）；`deed review --segment` 出清单时必须写 `--by`，清单记下 `review.brief.by` 并在控制台印「交给 …」；再出清单或落结论时换名字被拒（两种说法分开：自己交付过的段判不了；不是自己交付的，这一段的判断归原来那双手），只有人 `deed judge --overturn` 推翻过那一段的结论才允许换手（cli/verbs/review.mjs 的 maySwitch）；角色包写明「这一段一直由同一个人判」与这是第几份（cli/brief.mjs 的 guideText）；core/rules.mjs 的 handOf 让下一步印的命令带着那一双手；用例 test/cli.test.mjs 的 one segment keeps one hand, and the period review takes a fresh one 与 a period verdict that names a segment reopens it, and the same hand judges it again
  理由：机制被这条裁决取代：名字由通道决定，命令行不收 --by，面板按的行记 user、命令写的行记 agent；T132 那条「段审一直用同一双手」的机制随 e4b09a2 一起删掉
- [~] T142 一条命令换掉「撤回再重交」：task renew
  标准：交付过的条目在字节变了之后可以一条命令重记（记新内容与为什么），账本上留一条事件而不是 undo+done 两条；verify 不再把重记过的那条当过期；用例覆盖 renew 之后 verify 干净、事件种类只有 one 条
  理由：它给 task 动词加命令（task renew），而 T83 的方向是把 task 整个删掉；换成清单写法之后「撤回再重交」就是改勾再 submit，不需要第三个动词
- [~] T147 T79b 一轮只记一句话：说一句话就记下这一轮（say 取代 tick）
  标准：deed say "…" 记下这一轮，said 是位置参数；没有 --said、--did，也没有 --who（轮次只认 user，agent 的进展写交付记录或结论）；tick 从开关表、帮助与文档里消失，敲它 exit 1 并指到 deed say；state 与面板不读 did；有用例覆盖（tick 被拒且指路、say 落账、state 打印这一轮）
  理由：同一条写了两遍（T146 才是那一条），不重复做
- [~] T149 把 review 两套用例改成清单写法，再删 deed task
  标准：cli-review1/cli-review2 里不再调用 deed task；每条用例的条目一次写进清单再交付（现在逐条 addTask 会开新段，18 条用例因此变红）；改完 deed task 动词删除、敲它 exit 1 并指到清单，test/ 里 0 处调用；全量用例绿
  理由：与 T83 是同一件事的两半（T83 已含「测试改走清单+submit」），并到 T83 一起交付

