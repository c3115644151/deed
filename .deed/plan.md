# 这一期要做成什么
把操作面收成一个清单文件：写清单、deed submit 一次记账；要不要审看规模。

<!-- 这份文件就是这一期的清单：改它，然后 deed submit 一次记账。
     每条任务一行，开头是一个方框：方框里 ? = 新条目、空着 = 还没做、x = 已交付、~ = 不做了。
     方框后面跟着号和标题；改的时候只动方框与下面那几行，别改号和标题。
     一条任务可带一行 依据：能点回哪一轮立了它的原话；标题说的是要消掉什么现象。
     从议题里拆出来的条目写一行 来自：I1——只认已经锁定出口的议题，没出口的写不进去。
     勾上就得写一行「交付：」——跑了什么、结果几比几；不做了就得写一行「理由：」。
     注记两行：箭头加「延后：」这一次不做；箭头加「下一段：」送去下一段接着做，不是放弃。
     先后就是你排的行序：上下挪一下再 submit；一次只交一条。 -->

<!-- 已关闭 19 段（不再过目）：S02.1 3 · S02.2 12 · S02.3 2 · S02.4 3 · S02.5 2 · S02.6 1 · S02.7 2 · S02.8 2 · S02.9 3 · S02.10 3 · S02.11 4 · S02.12 3 · S02.13 2 · S02.14 1 · S02.15 1 · S02.16 1 · S02.17 1 · S02.18 16 · S02.19 12 -->

## 段 S02.20
<!-- 已完成（33 条）：交过的，往下沉 -->
- [x] T97 整期审的范围在发出那一刻固定：预备段里后来的活不让它过期
  标准：整期结论的过期只看它发出那一刻已经存在的段；之后预备段里新加的任务、新的交付不让它过期；被点名退回的段重新打开时它照旧过期；有用的用例（发出整期清单之后在下一段加一条任务并交付，整期结论仍算数）
  交付：core/rules.mjs 的 stalePeriod 只看发出那一刻已经存在的段（由 plannedAt／openedAt 判），之后另开的预备段里加活、交付都不让它过期；已经存在的段在发出之后又落结论、或被点名退回后重判才算过期；用例 test/rules.test.mjs 三条断言（什么都没动→不算；新段里加活→不算；已有段发出之后又落结论→算）；期望：node --test test/rules.test.mjs => ✔ a period brief goes stale only for segments that existed when it went out
- [x] T118 角色包写清审查者怎么动手：要在副本上做实验，仓库里一个字节都不动
  标准：角色包把「你不能改代码」那一节换成「你怎么动手」——可以跑任何命令、造夹具、把整个工作区复制到仓库外做破坏性实验与变异（改一处判断 → 跑对应用例 → 看它是否真红），仓库内零改动；不能提交、不能改账本与正在审的两份材料、不能替作者修；每条结论与发现都要配复现路径（命令 + 实际输出，或 文件:行）；有用例盯住这几句话在角色包里（少一句就红）
  交付：用例不再只盯「临时区在仓库外」与「不能提交」两句：角色包六句边界逐句断言（仓库里一个字节都别动、别改账本、不能提交、别替作者修、每条结论与发现都要配复现路径、有没达成的），变异核对两次——删「别替作者修」那一行后 20 条里 19 过 1 红，还原后 20/20；期望：node --test test/cli-review2.test.mjs => ✔ the reviewer's scratch sits outside the workspace and the pack says no commits
- [x] T114 记账之后核一遍刚落下的交付：指得到那份内容、不是空交付，核过要印一行
  标准：落账后把刚写进账本的每条交付再核一遍：路径指得到当时那份内容、且不是空交付；对不上或空交付就打印并 exit 1；核过时印「落账后核对 · N 条都对得上当时那份内容」；用例直接驱动这个核对（记下 a.md 是一份内容、盘上已换成另一份 → 报出来；空交付 → 报出来），另有 submit 的用例盯住那一行（删掉这一步立刻红）
  交付：记账后核对不再只比大小：task.done 多记一格 sha（{路径: sha256 前 16 位}，只为当场核对与「同一份字节不跑第二遍」，不作门）；lib/landed.mjs 先比尺寸再比指纹，尺寸一样内容换过的也报出「尺寸一样，内容不同」并 exit 1；含义版本 36、package 0.33.0；期望：node --test test/cli-work2.test.mjs => ✔ the landed check reports a file that changed, emptied, or vanished
- [x] T135 清单按状态分三段：正在做的、还没做的、已经了结的
  标准：清单（`.deed/plan.md`）里每一段的条目按「在做（最多一条）→ 等着（按行序）→ 已完成 → 撤回／放弃」排，各组之间空一行并各写一句小标题；已完成的排在新待办之后，撤回与放弃的排在已完成之后；有用例（四组之间各空一行）
  交付：cli/plan.mjs 的草稿在四组之间各空一行（原先挨着写）；标准里 `deed plan --print` 那一半已按 task.criteria 改成只认清单这一个入口；期望：node --test test/cli-work1.test.mjs => ✔ the plan puts a blank line between the groups
- [x] T124 用户只有三个闸，且都在面板上：议题通过、判决通过、签收通过
  标准：命令行不再提供这三条路——deed sign、deed judge、deed topic release 都 exit 1 并指到面板；面板上只有满足条件时才出现对应按钮；点了才落账、带 via:"panel"；三条闸各有用例
  交付：cli/verbs/topic.mjs 把 release／establish 放在第一个词的位置上一律 exit 1 并指到面板：此前 `deed topic release I1 --body … --points …` 会静默建出一个标题叫 release 的议题；期望：node --test test/cli-work1.test.mjs => ✔ topic release on the command line refuses and creates nothing
- [x] T145 结构检查对着范式判格：必需格、目录归属、extras 豁免
  标准：core/checks.mjs 有 PARADIGM（software/document/data/work/free）；结构检查四步：范式要求的格都在、声明的目录都在盘上、盘上每个顶层目录都有归属（认领或 extras）、跨格方向按 mayImport；layers 写 role=dir，role 缺省取 dir；project.declare 收 role 与 extras；deed project 支持 --extras；缺格/无归属/方向反三种失败各有具体 detail 与修法；本仓声明 tests=test、extras=docs,examples,support 后 3/3；沿用三种状态的语义，未通过不挡任何动作
  交付：结构检查按 role 判格不按目录名判（偏离只印出来），缺格/无归属/方向反照旧红；board/board.test.mjs 挪进 test/；extras 补 adapters、删掉根上那个未跟踪的 undefined 目录；本仓 deed check 3/3（003f367）；期望：node cli/deed.mjs check => 3/3 条通过
- [x] T133 免审的段不出清单：没人要答的卷子不进账本
  标准：deed review --segment S0x.N 出清单之前先算 needsReview；算下来不用审就打印「审查设置说这一段不用审」，不写账本、不生成清单与角色包，下一步指到 deed review --segment S0x.N --skip --why
  交付：免审段出清单之前先算 needsReview：算下来不用审就不写账本、不生成两份文件，下一步给完整的 review --segment … --skip --why（003f367 补上缺的段号）；期望：node --test test/rules.test.mjs => a segment the gate says not to review waits to be sealed
- [x] T126 送审即冻结只挡交付与撤回交付：记录层面的照旧，落结论不比字节
  标准：清单发出去、还没被回答的这段时间，这一段拒收交付与撤回一条交付（新条目另起一节开下一段）；记轮次、写要点、延后、放弃照收，它们是决定不是文件；撤回清单是唯一出路，撤回后回到执行态；落结论不比字节；有用例
  交付：清单发出去之后这一段拒收交付与撤回交付，记录层面（延后、放弃、记要点）照收；撤回清单回到执行态；落结论不比字节；期望：node --test test/cli-review2.test.mjs => a frozen segment refuses work until the brief is withdrawn
- [x] T121 清单的行序就是做事的顺序：条目在文件里排在哪，就按那个次序印
  标准：位置按条目在它那一节里的第几行算，submit 落一条 task.order（段内算、不跨段）；deed state 的下一步、deed plan 的草稿、面板三处读同一个次序（core/rules.mjs 的 byOrder）；已封存的段里的条目不被事后重排；挪动之后账本只多出 task.order；有用例
  交付：条目位置按它在那一节里的第几行算，三处（state 的下一步、草稿、面板）读同一个 byOrder；挪两行只落两条 task.order（665033f）；期望：node --test test/cli-work2.test.mjs => the order of the rows is the order the work happens in
- [x] T88 让议题卡里的轮次号能点回那一轮原话
  依据：2026-11-24 用户轮「讨论机制按议题来…轮次只做索引、能点回原话」
  标准：要点记下它来自第几轮（point.add 落 round）；面板议题卡把那一轮做成 #turn-N 的锚点，点得到；折叠与面板各有用例
  交付：要点记下它来自第几轮（point.add 记 round，只数到记要点那一刻的 user 轮）、面板议题卡把那一轮做成 #turn-N 锚点可直接点回原文（cdf949e）；期望：node --test test/fold.test.mjs => a point remembers which user round it came from
- [x] T153 给适配器的段审复用与整期审各补一条可复跑的用例
  依据：P2 记的「没跑过：段审复用（sendMessage 第二条路）、期审（kind:period）」
  来自：I1
  标准：在 test/ 里加两条用例，用事件夹具驱动适配器的两条路——同一个审查者接着判下一段（复用，走 sendMessage）、整期审另开一个（kind:period）；断言账本里落下对应的 review.brief 且 kind 对得上；node --test 全量绿；两条用例各自删掉判断会红
  交付：test/adapter-review.test.mjs 两条——同一个段的重审发回原来那个审查者（不再起一个）、整期审在段审之后另起一个（名字与段审不同、没把期审清单发给段审那个）；用替身宿主（ctx.on 收钩子、subagents 记账）驱动真适配器，不起子代理；变异核对：去掉复用那一条 → 第一条红（pass 1 fail 1）；把期审的 hand 写死成段审那个名字 → 第二条红（pass 1 fail 1），改完即还原；全量 261/261
- [x] T141 同一份字节不重复跑 --run，submit 认上一次真跑过的结果
  依据：2026-11-25 用户轮「做任务太慢，第一优先级是效率…机制化地优化」
  标准：submit --run 在「自上次记录以来工作区内容没变」时复用那次结果并把它记进交付记录（记着那份结果的来源与工作区指纹），变了就照旧真跑；用例覆盖复用与失效两条路；不得出现「复制来的数字」——复用的是同一份字节上的真跑
  交付：lib/store.mjs 新增 workspaceFingerprint(root)（路径与内容的整排哈希，跳过同一批目录）；cli/verbs/submit.mjs 的 runOnce 跑之前取指纹并记 at，run 记录带 fingerprint/at/reused，账本里同命令同指纹就复用（reusedRun 从账本找、cachedRun 从 .deed/tmp/runs.json 找），被拒的那次也先落缓存；core/events.mjs 校验 run.fingerprint/at/reused；DESIGN §12 补「同一份字节不跑第二遍」；test/cli-reuse.test.mjs 两条（只改清单 → 复用且计数器仍 1；换了字节 → 真跑且计数器 2）；全量 259/259
- [x] T140 先后只在任务相对次序变了时才记，完成一条不连累后面
  依据：2026-11-25 用户轮「做任务太慢，第一优先级是效率…机制化地优化」
  标准：真实账本里 task.order 542 条、138 条任务（约四倍）；改成 submit 只比较「还没了结的条目在清单里的相对次序」，次序没变就不落 task.order；依次完成五条以后账本新增的 task.order 为 0（用例盯住事件数），把两条行上下调换再 submit 才各落一条；旧账本照旧读
  交付：cli/verbs/submit.mjs 删掉按绝对位置比先后（placeOf 只给新条目用），改成按段算 orderPlan——清单这一节还没了结的条目排成一列，账本里现成的数字按这个次序发下去，次序没变一条都不写，真调换两行只有那两条换到数字（空出来的数字留着，不重排做完的条目）；test/cli-work1.test.mjs 一条用例（依次做完三条 task.order 为 0、调换 T4/T5 各落一条且 T1 不动）；全量 257/257
- [x] T93 只有真要出整期审时，state 才提目的
  依据：2026-11-24 用户轮「讨论机制按议题来」后的状态呈现讨论
  标准：单段会话的 state 不印「目的 · 还没有」；多段且要整期审时印成「整期审的尺子 · …」；deed --help 与 DESIGN 里 goal 的说法同步（T81 删掉 goal 动词之后，那句话只指清单第一行）；有用例
  交付：cli/session.mjs 的 printState 只在多段的期把目的印成「整期审的尺子 · …」，单段印「目的 · …」、没写也不再催「还没有」；DESIGN §12.1 补这条印法；旧动词 goal 的指路仍是「清单第一行」（deed goal 的子命令路径已断言）；test/cli-state1.test.mjs 新增一条（单段不催、单段写了照常印、多段按尺子印、goal 拒绝话指到清单第一行）；全量 256/256
- [x] T81 T81 收口与免审并进已有动词：review --skip、sign --shelve，删 goal
  标准：deed review --skip --why 封免审段（取代 deed seal）；deed sign --shelve --why 归档（取代 shelve）；deed goal 删除（目的来自清单第一行，submit 已落 goal.set）；三个旧动词 exit 1；有用例覆盖
  交付：deed review --segment S02.20 --skip --why "…" 落 segment.seal（cli-review1/2 与 rules 的用例都走这条路）；deed sign --shelve --why "…" 落 shelve，不带 --shelve 时仍只回「去面板上按」；deed goal 删除，目的写在清单第一行、submit 落 goal.set（cli-state1 的用例改成改第一行再 submit）；三个旧动词 exit 1 并指到新名（seal→deed review --segment S1.1 --skip --why，shelve→deed sign --shelve --why，goal→清单第一行）；deed help 按「讨论/执行/验收/管理」四组打印（cli/spec.mjs 的 GROUPS 是唯一来源，ORDER 由它摊平）；say 的 --by 删掉；这一份字节上 node --test 219/219（agent）
- [x] T83 T83 删掉旧命令：cli/verbs/task.mjs 真删除，测试改走清单+submit
  标准：cli/spec.mjs 与 ORDER 里不再有 task；cli/verbs/task.mjs 删除；test/cli.test.mjs 里 163 处 task add/done/undo/defer/drop 的夹具改走 deed plan + deed submit（或集中在一处替身里翻译），并有用例断言旧动词 exit 1；全量绿
  交付：命令面收敛收尾：cli/verbs/task.mjs 已删除，cli/spec.mjs 的 SPEC 与 GROUPS 里不再有 task，敲它 exit 1 并指到 deed plan／deed submit；test 里 84 处 deed task 调用改走清单+submit（cli-review1 27、cli-review2 57），board 的闸夹具与 cli-due／cli-state2 一并换掉；submit 对「已交付条目再勾一次」不再静默跳过——冻结的段说在审／等你判决，没冻的说先取消勾选写理由；期望：node --test => ℹ pass 230
- [x] T91 清单条目要写明来自哪条议题，没确认的议题不能用
  依据：2026-11-24 用户轮「讨论机制按议题来…冲突拆成题」
  标准：plan 行可带一行 来自：I1；submit 核对议题存在且已放出，否则整批拒并点名第几行；task.add 落 topic；没放出的议题一条都出不来；state 在「有已放出的议题、清单还没条目」时把下一步指向写清单；有用例
  交付：cli/plan.mjs 的字段表加「来自」→ topic（草稿也印这一行）；core/events.mjs 的 task.add 校验 topic 写成 I\d+，EVENT_VERSION 32→33；core/fold.mjs 的 task.add 找出议题、没出口的拒并说清，条目带 topic，议题那头落 exportedAt 与 exported；cli/verbs/submit.mjs 记账前核对议题存在且已 released，没出口的整批拒并点名第几行；core/rules.mjs 出口那一步改指写「来自：I1」；test/discussion.test.mjs 三条（清单解析 来自、折叠拒没出口的、出口后议题记得住、CLI 整批拒并落账）；DESIGN §2 出口段补记法；package 0.30.0。全量 254/254
- [x] T117 放弃撤不回：错撤的条目要能回到交付
  标准：放弃过（task.drop）的条目能撤回那条放弃并回到未做，从而重新交付——`deed task undo T<号>` 承认的是最后一条（放弃也是一条），账本只追加，撤的是效力不是记录；没有可撤的放弃就拒并说清；state、面板与清单里看得出这条「放弃过、又回来了」；有用例（放弃 → 撤回 → 能再交付并出现在清单上；撤一条从未放弃的 → 拒）；旧账本里的放弃照读
  交付：跑：node --test 213/213（其中 test/fold.test.mjs 35 条、test/cli.test.mjs 119 条，两条新用例在 fold 与 cli 里）；core/fold.mjs:283-291 的 task.undo 落在放弃/延后上时把任务放回未做、revived 记下走过这一遭，cli/verbs/submit.mjs 允许把 ~~ 改回 - [ ] 并在缺 理由： 时拒；清单印「撤回过的放弃」、deed state 印「（撤回过放弃）」、面板挂同一句；变异：把 fold 那一支改成 if(false) → fold 一条红，把 submit 的 if(!item.why) 改成 if(false) → cli 那条红
- [x] T119 done 之前先算段内那一步：待裁不再劫持「下一步」
  标准：`deed state` 的下一步先算这一段此刻真能动的那一步（还有没做的条目 → 交付；结论旧了或不合格 → 重审或落结论；段关着 → 整期审或签收），这些都轮不上时才轮到待裁；有待裁项时 state 仍单列「待裁」不消失；有用例（开着一条待裁、同时段里还有未做条目 → 下一步是交付；待裁与一切就绪同时存在 → 下一步是审批/签收，待裁仍印出来）
  交付：跑：node --test 215/215（board/board.test.mjs 的 the page names the next actor… 盯着「段里还有该做的事时，下一步不是待裁」，cli 的 state 用例跟着走）；core/rules.mjs 的 nextAction 先算冻结→段内交付／记下文件／审与落结论，待裁排在这些之后、仍单列
- [x] T122 撤回一条「改到下一段」，走空的段跟着消失
  标准：`deed task undo T<号> --why "…"` 能撤回一条 carry——条目回到它原来那一段，那一段重新成为预备段；被走空的那一段从段列表里消失（段由条目生出来，不是计划）；撤销一条从未挪过的条目仍被拒并说清；有用例（挪出去再撤回来，段列表只剩一条；把删段那一行改掉，那一条红）
  交付：跑：node --test test/fold.test.mjs 37/37（两条新用例：撤回之后段列表只剩一条、没撤过可撤的仍被拒）；core/fold.mjs 的 task.undo 在条目还没交过、站在最末一段时把它送回上一段，把那一段的 carried 置回 true，并把走空的那一段从重放结果里删掉；变异：把删段那一行改成 void left → 那一条红
- [x] T125 段可以在清单里预先排：多段一次写出，按行序依次开段，只有当前段收活
  标准：清单里写多个 `## 段`，submit 按行序把条目归到各段（不是一律塞进当前开段）；同一时刻只有一段收活，前一段有结局后下一段才开；`deed plan --print` 与 state 显示各段处于哪一步；没预排的清单行为不变（条目仍落当前开段）；有用例覆盖两段预排、依次开、前面没结局时后面不开
  交付：跑：node --test 223/223（全量）；core/events.mjs 含义第 24 版加 segment.plan（空标题的一节 submit 领号）；core/fold.mjs 的 task.add 认 segment（落在清单排好的段里），nextSegment 按已有最大号 +1 编号（旧账本重放仍落同一段），task.carry 第 24 版起目标是「下一个还没关闭的段」，没有就拒（先在清单里加一节），旧行按当时那套读（含自己开段的旧读法）——预备段这个概念删了；core/rules.mjs 加 takingSegment（收活的那一段＝队列里第一个非清单排出来的未关闭段）与 queuedSegments；cli/plan.mjs 的 parse 收 sections 与 sectionTitle，draft 对排队段多印一行注释；cli/verbs/submit.mjs 按节映射段（段号写了就用、空标题领号、同批递增防重号）、先把段声明在条目前面落账、给排队段勾交付整批拒；cli/session.mjs 与 cli/verbs/review.mjs、seal.mjs 对排队段的交付/送审/封存当场拒并说清现在收活的是哪一段；board/render.mjs 排队段挂「等前面」（验收屏与执行屏）并按 takingSegment 判当前段；deed state 同时印出排队段与收活段。用例：test/fold.test.mjs 39/39（改到下一段落进清单排好的段、没有下一段当场拒、旧行照旧读）、test/plan.test.mjs 与 rules 72/72、test/cli.test.mjs 121/121 里 the plan can line up several segments, and only the first takes work 与 an entry still to be done is carried to the next segment from the plan。
- [x] T127 一段结束后段审，全段结束后期审，签收在期审之后
  标准：`deed review --segment S0x.N` 判这一段（照旧）；`deed review --all` 作为期审判整期，回答的是这一期的目的与跨段一致性，不是另一道签收；期审的清单与结论成对（review.brief 与 review.log 记 scope:"session"），旧账本里早先的 session 结论仍只作历史、不挡签收；每一段都有结局、无未做、无已交付未判之后才出期审清单，期审 pass 才轮到签收，fail 点名哪一段就重开那一段；`deed state` 在段全关之后先给「出期审清单／落期审结论」，面板同步；EVENT_VERSION 升 1、旧行照读；有用例（段没关全不出发期审清单；期审 pass 之后签收可行；期审 fail 点名一段则那一段重新打开）
  交付：deed review --all 以期审的身份回来：清单与角色包由 cli/brief.mjs 的 planWhole 生成，列目的、各段结局、这一期定下的边界与弃、还挂着的东西，不列段里的条目；core/rules.mjs 的 needsPeriodReview／periodState／stalePeriod／periodFresh／periodReviewers／segmentReviewers 说得出现在这一步；signBlockers 多一条「这一期的期审没通过」，nextAction 在段全关之后先给期审，写清换一双手；期审 pass 才轮到签收，fail 点名段号则那一段重新打开、条目保持交付（core/fold.mjs 的 session-scope fail 分支）；EVENT_VERSION 20 / MEANING.periodReview，更早的 session 结论只作历史、不挡签收。全量 219/219 跑在这一份字节上（另一次运行由 --run 采）；变异：把 signBlockers 里期审那道门注掉 → rules 两条用例红（0 过 2 败）
- [x] T128 一段发过多份清单时，只有最后那份算还在等结论
  标准：`awaitingVerdict` 只看这一段手上的最后一份清单（scope:segment 的最后一条 review.brief）；前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；再出一份、被回答之后这一段回到执行态，冻结算的是同一句；旧账本照读；有用例（同一段发过两份、第一份没人回答、第二份被判 → 段不再等结论、新活落回这一段；把判断改回「有任何一份没被回答」即红）
  交付：core/fold.mjs:98-105 的 awaitingVerdict 只看这一段最后那一份清单：前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；冻结算的是同一句；新增 test/fold.test.mjs 的 a second brief supersedes the first one nobody answered，变异把判断改回 some 时那条红（fold 37 过 1 败），还原后 fold 38/38；这一条走 task done，全量 216/216 是同一份字节上跑过的，但没被 --run 采进账本
- [x] T129 冻结只拦写：账本里已经落下的行一律照读，重放不因这一段后来送了审就判它坏账
  标准：冻结的拒绝发生在落盘前一刻（cli/session.mjs 的 refuseFrozen：task.done 与「撤回一条已交付」两类事件），core/fold.mjs 不再为冻结抛错；一份没人回答的清单出现在某条交付之后，整本账仍能重放、面板仍出正常页；交付与撤回交付在写的一侧仍被真拒并说清出路；有用例（重放含「清单已发出＋之后又落一条交付」的账本不抛；把判断加回 fold 即红）
  交付：跑：node --test 217/217（全量，数由 --run 采）；core/fold.mjs 的 task.done／task.undo／task.order 三处不再为冻结抛错，改由 cli/session.mjs 的 refuseFrozen 在落盘前一刻拦（task.done 与「撤回一条已交付」两类），措辞与原来一致；新增 test/fold.test.mjs 的 a line that landed while the segment was frozen still replays；test/cli.test.mjs 的 a frozen segment refuses… 仍红着盯住写的一侧；面板重启后 7317 出的是正常页（461349 字节）
- [x] T134 三个屏都从新往旧排：最新的在最上面
  标准：讨论屏的轮次、执行屏的段与条目、验收屏的签收差，全部按账本里发生的先后倒过来印——最新的在最上面，最早的沉到最后；同一屏里不混着两种次序；面板真开一次看，最新的一条不在需要往下翻的位置；有用例（造三条先后发生的记录，印出来最上面的是最后发生的那条）
  交付：三屏倒序：最新的在最上面（段与条目都倒过来）。
- [x] T136 一次只交一条：一批落下好几条交付不再收
  标准：`deed submit` 一次落下的交付多于一条就整批拒，并说清「先交此刻那一条，做完再交下一条」；勾一条照旧；旧账本里同批的旧记录照读（批号那几格不动）；清单上标出「在做」的那一条，其余待办标成等着；有用例（一次勾两条 → 拒且账本零新增；勾一条 → 成）
  交付：一次只交一条：submit 勾了两条以上整批拒，账本零新增。T125 之后 submit 改了落段的写法，按今天的字节重记。
- [x] T138 判决是审查通过之后用户按的第二道闸：段由判决关闭，签收按期
  标准：审查者的 pass 只把这一段交回来（segment.verdict="pass"、reviewedAt/reviewedBy，closedAt 仍为空），这一段不再收新活、交付与撤回交付照样冻结；用户只在面板上按「判决通过」（落 verdict.pass，带 by 与 via:"panel"），按下之后这一段才关闭、段内已交付转 accepted；没有审查通过时限不了判决、判过的段不能重判；签收等每一段都有结局（判决或 seal）、无未做/未判/待裁、期审通过；deed state 在审查通过后给的下一步是 user·判决，面板在等判决的段上出那个按钮；旧账本里 pass 即关闭的行按旧含义读；三条用例（审查未通过判不了、pass 之后签收仍被挡且交付被冻、判决之后段关闭并可签收）
  交付：判决是审查通过之后用户按的第二道闸（含义第 23 版）；T125 改了状态的印法，按今天的字节重记。
- [x] T139 拆开最慢的那个测试文件，让每一轮验证从两分半降到一分钟
  标准：test/cli.test.mjs（154 秒，占全量 98%）按主题拆成若干文件并抽公共步骤到 test/support/cli.mjs；node --test 的用例总数与拆分前一致（121 条），单条断言不变；`node --test` 的实际耗时降到原来的 40% 以下（同一台机器、同一份字节），package.json 加 `test:fast`（core+board+docs，1 秒级）
  交付：跑：node --test 224/224（全量，同一份字节；拆完之后全量 63.8 秒，拆之前单文件 test/cli.test.mjs 一条就 154.1 秒）；test/cli.test.mjs 按主题拆成八个（review1/2、work1/2、state1/2、rules1/2，共 121 条，一条不少），公共步骤抽到 test/support/cli.mjs（CLI、OFF、deed、later、gate、judgeAll、judgeHere、signHere、judged、kinds、briefs、proof、writeLines、planFile、writePlan、readPlan 共 15 个具名导出，从 test/ 里 import 一个就够）；每条用例的断言一句没动——拆分只挪行；package.json 加 test:fast（fold+rules+plan+docs+board，1.5 秒）与原有的 test（node --test）。量：拆前 $t=154.1s（test/cli.test.mjs 单跑），拆成四文件 71.7s，八文件 62.7s；全量 223→224 条、63.8s。
- [x] T144 体检层：这个工作区还是不是一个项目，用一张有序的检查表算出来
  标准：core/checks.mjs 是纯函数（账本 + 目录快照 → 逐条结论），CHECKS 有序、每行登记"事实/判定/修法/能力"；三种结论 pass/fail/na，未声明项目时项目级检查一律 na 且不算未结项；projectState 给 declared/shape/passed/total/missing 且会随树走样退回去；project.declare 事件（含义 25）进账本，认可不落盘；deed check 只读、exit 0、逐条印结论与修法；deed state 顶上印"项目 · 形态 · k/n"或"没有声明（工作区模式）"；未通过不挡三种状态；既有用例全绿
  交付：node --test 212/212（全量，含新 test/checks.test.mjs 8 条与 cli-state2 的 standing 用例）；core/checks.mjs 的 CHECKS 三行（工作区/树/背景）各有 事实·判定·修法·能力 四样，checkAll/projectState 不读盘不读钟；lib/tree.mjs 只提供目录与相对 import；deed check 只读、未通过也 exit 0，逐条印 ✓/✗/— 与修法；deed state 顶上那行随说了算的账本变（本仓已声明 software，4 层方向都对，3/3）；project.declare 是含义第 25 版的事件，package 0.22.0；DESIGN §13、README 命令表与事件表、规则块三份同步
- [x] T146 T79b 一轮只记一句话：deed 说一句话就记下这一轮（say 取代 tick）
  标准：deed say "…" 记下这一轮，said 是位置参数；没有 --said、--did，也没有 --who（轮次只认 user，agent 的进展写交付记录或结论）；tick 这个名字从开关表、帮助与文档里消失，敲它 exit 1 并指到 deed say；state 与面板不读 did；有用例覆盖（tick 被拒且指路、say 落账、state 打印这一轮）
  交付：deed say "我改了三处" 落账为一条轮次（said 是位置参数，报告「已记一轮」）；deed say "…" --who user 被拒（不认 --who）；deed say "…" --said x 被拒（不认 --said）；deed tick "…" exit 1 并指到 deed say（cli/deed.mjs 的 MOVED 表）；帮助与开关表里 tick 0 处；state 只印原文，不读 did；这一份字节上 node --test 218/218（agent）
- [x] T148 T82b 一个体检入口：账本与门并进 deed check（doctor、gate 下线）
  标准：deed check --ledger 逐行校验账本并可重放，坏账报哪一行哪一条、退出码 1，账本比程序新时说升级而不是坏账；deed check --gates [名字…] 按账本里 gates 的顺序跑，第一条不过就停、报名字与退出码，没有门时说清怎么写；deed check 不带开关仍只打项目状态并退出码 0；doctor 与 gate 两个动词删除，敲它们 exit 1 并指到 --ledger / --gates；有用例覆盖
  交付：deed check --ledger 逐行读、逐行重放（cli/ledger.mjs 的 checkLedger）：干净时印「账本干净 · 1488 条事件都能重放」与接入/心跳两行；坏账报「账本坏了 · 文件名 第 N 行」并给唯一允许的修法，退出码 1；账本比程序新时印「账本比 deed 新」与升级指引而不是坏账；deed check --gates 按 gates 顺序跑（没有门时印「这个工作区没有门」并给一行 config 写法），第一条不过就停；deed check 不带开关仍只打项目状态（本仓 2/3）、退出码 0；doctor 与 gate 两个动词删除，敲它们 exit 1 并指到 --ledger / --gates（cli/deed.mjs 的 MOVED）；面板顶部与帮助页的指路、INSTALL/DESIGN/research 同步；这一份字节上 node --test 219/219（agent）
- [x] T150 观察层：命令面自己怎么被用——从没敲过的、敲了就失败的、没人用的开关
  标准：每次调用在 .deed/debug/*.jsonl 留一行（动词、成没成、耗时、开关名、被拒的那一句），不进账本也不进方案快照；deed debug [--days N] [--json] 印三节：从没敲过、敲了就失败最多、一次没用过的开关；样本不足时报告自己说出来；有用例覆盖一行一调用、开关只记名不记值、窗口只认窗口内的、报告与 --json 的字段
  交付：观察层落地：cli/trace.mjs 一处写（dispatcher 收尾：动词、ok、ms、开关名、被拒的那一句），cli/verbs/debug.mjs 一处读（从没敲过 / 敲了就失败最多 / 没人用过的开关 / 拒绝的话按次数 / 最慢的 p95），--json 给机器；trace 不建 .deed、不进快照、不进账本；顺带删掉 init 里早该没有的 --who；期望：node --test => ℹ pass 239
- [x] T152 执行屏任务依据里的来源能点回讨论屏原文
  依据：2026-11-27 用户轮「执行层面也需要支持直链跳转，新任务结构要引用来源」
  标准：执行屏任务卡的「依据」里写 P14／I1／第 N 轮 就做成直链，点它切到讨论屏并滚到那条要点、议题或人话原文；不存在的号原样留字、不造死链；讨论屏要点、议题、轮次带锚点；board 有用例，面板真开看过
  交付：board/render.mjs 加 anchorSet/linkRefs，执行屏 taskRow 的「依据」把 P/I/第 N 轮 做成 <a class=xref data-screen=discuss href=#id>；讨论屏要点/议题/轮次带 id 锚点；点 xref 切到讨论屏、滚到锚点、写 location.hash；不存在的号原样留字；board.test.mjs 一条用例（3 种可链 + 死链不造 + 锚点存在）；DESIGN §15 补说明。真开面板点击验证：T151 依据 P14 点击切屏并滚动到位。全量 251/251、board 19/19、docs 5/5

<!-- 撤回或放弃（26 条）：不做了的，沉到最后 -->
- [~] T143 把不对的机制删掉：账本不对字节、清单每份列全部、去掉「先做后记」与每段花了多少
  标准：cli/audit.mjs 与 verify 动词删除；交付记录只记路径与字节数；清单每份列全部条目；先做后记与每段花了多少都删除；DESIGN/README/规则块与代码同一口径；留下的用例全绿
  理由：它的标准和 T114 互相矛盾——一个要「交付记录只记路径与字节数」，一个要「路径指得到当时那份内容」，同尺寸换内容只有指纹看得出来。按用户的裁决重新写成一条（T155），不在这条上两头讨好
- [~] T87 议题是账本上的对象：立项、追加正文、折得出状态
  标准：deed topic "标题" --body "…" 自开号 I1、I2（与题的 A、清单条目的 T 不撞）；再次 deed topic I1 --body "…" 追加正文；core/fold.mjs 折出 topics（id/title/body/轮次索引/状态）；不复制任何轮次正文；EVENT_VERSION 升 1 且旧账本照读；有用例覆盖立项、追加、空标题被拒
  理由：议题立项/追加/折叠都在，但立项的命令形态被「先记要点、再用 --points 统合成正文」取代（deed topic 直接 --body 立项会被拒），这条标准写的是那个已经不要的形态；能力随 T91 的出口一起在用
- [~] T80 T80 题：删 --why，resolve/withdraw 变 answer/drop
  标准：deed ask "…" --reading 记下题；deed ask answer A1 --decision --by 与 deed ask drop A1 --why 取代 resolve/withdraw；ask 不收 --why；裁定里的「边界：」「弃：」照旧认；旧动词 exit 1；有用例覆盖
  理由：题与 ask 这个对象整体删掉了（讨论改成原文→要点→议题），这条的标准全落在已经不存在的动词上；改正它只会写出一句与当初无关的话，它要的能力由议题两次按钮取代
- [~] T101 审查结论按条落下：判过的条目下一轮不再重判
  标准：review.log 带 results:[{id, verdict, note}]，一条条目一个判定（达成／未达成／无法判断）；pass 只在段里每条条目都有判定时才封段，缺哪条就拒并说出号；重审的清单只列「还没判过」与「自上次判定以来字节变过」的条目，其余条目的判定沿用；旧账本里没有 results 的结论照读（按整段 pass／fail）；有用例（判过 T1 之后改 T2，重审清单只列 T2，pass 之后 T1 的旧判定仍算数）
  理由：「判过的条目下一轮不再重判」在 T143 里被删掉（清单每份列全部条目、pass 要逐条判）；这条要的机制与现行口径相反
- [~] T113 预备段里写「改到下一段」真的挪出去，一段才切得动
  标准：从预备段里改出去时开一个新预备段并把它挪进去，源段的 carried 置 false（它不再接新活，只等结论）；那一段一条都没交过时当场拒并说清怎么办；旧行按它写的时候那套含义读（EVENT_VERSION 14 / MEANING.carryOut）；有用例覆盖这三件事，且去掉其中任一判断会让对应的一条红
  理由：改到下一段仍在，但「源段 carried 置 false」「一条都没交过时当场拒」随段预排（segment.plan）作废，剩下那部分已由段的机制覆盖
- [~] T116 落账那一刻自查：刚落的钉当场就旧、或数当场对不上，就地报出来
  标准：交付时对每个路径取两次 sha（量差前与落账后），不一致就拒；落账后立刻跑一遍 verify 的核对，若刚落的钉当场过期或空交付，当场打印并 exit 1，不等审查者；有用例（落账前手改文件 → 被拒；正常交付 → exit 0 且不报）
  理由：账本不再对字节（T143 删了内容指纹），「落账那一刻取两次 sha、旧了就报」没有对象了；同类的核对改在记账之后做（T114 那一条）
- [~] T120 发现是主张不是判决：可 fix / defer / reject，结论只判标准
  标准：每条发现落账时带处置与依据——fix（已改，指到改在哪）／defer（登记成条目，说清为什么不在这轮做）／reject（不认，给依据）；账本里读得出曾经打过哪条、作者怎么回的；下一次出清单时，上一份里还没被回答的发现要印在材料上，等审查者回答那条反驳；段结论只判「标准在这一份字节上成立不成立」，不因为「作者没照建议做」单独判不合格（除非那条事实使标准不成立）；有用例（reject 一条并给依据 → 账本可读、下一份清单印出那条反驳；只写形容词的 reject 被拒）
  理由：发现仍是主张、结论只判标准（这一半在）；fix/defer/reject 三分从未落进账本，后来的口径是「发现写清楚，处置是作者下一次交付的事」——这条要的对象不存在了
- [~] T123 清单没被回答之前这一段冻结：要么审，要么撤回清单再改
  标准：一份清单发出去、还没被回答的这段时间，这一段是冻结的——`deed submit` 拒收这一段的任何改动（新条目、交付、撤回、放弃），并说清三条出路（落结论／撤回清单／把改动交到下一段）；新活落进下一段而不是这一段；`deed review --segment S0x.N --withdraw --why "…"` 把这份清单撤回并作废（记一条 review.withdraw），段回到执行态、可以继续改；落结论时逐条核清单上每条的交付记录与今天的字节，变了就拒并点名哪一条，指到撤回清单或落进下一段；旧账本照读；有用例覆盖上面每一条（去掉冻结那一条判断即红）
  理由：冻结的范围后来由 T126 收窄（记录层面照旧收）；它真正缺的那条（新条目落进在审的段）已在 6c488f3 修好并有用例
- [~] T130 记账之前那一次核对，收据由核对的函数自己印：接线掉了用例就红
  标准：`requireUnchanged` 核过时自己印「记账之前再核一遍 · N 条没有变」，调用处不再另印一句（印在调用处的收据只能证明调用处那行还在，证明不了核对真跑过）；`deed submit` 与 `deed task done` 两条路都有 CLI 用例盯住这一行；把两处 `requireUnchanged(ROOT, pins)` 任意一处注掉，对应用例当场红；有用例覆盖（本段实测：注掉两处后 one delivery pins every file 与 a plan lands as one batch 两条都红）
  理由：requireUnchanged 随「账本不对字节」一起删了（T143），这条要的收据没有函数可印
- [~] T151 任务只保留标题、标准、依据三样，标准过时会提示
  依据：P14 的判断；用户要求任务能让陌生 agent 独立推进
  标准：task.add 带 problem/source/premise；task.context 可补上下文不改标题标准状态；清单草稿解析与渲染三字段；审查材料与面板显示；core/stale.mjs 机械查过期（只查未做且段开着的任务），deed state 只读提示；老账本照读
  理由：三字段（问题/依据/前提）被用户判成塞一堆没意义的字段，字段定为标题/标准/依据三样（6aa36d9）；这条的标准要的是已经删掉的两样
- [~] T137 给六条只有一句话的交付记录补上能当场跑的命令和结果
  依据：2026-11-25 用户轮「开始 19 段的开发…缺乏上下文就查对话记录或直接问我」
  标准：`S02.19` 那六条（T100、T104、T107、T109、T110、T112）的记录里，每条都带一条当场能跑的命令，以及它该印出来的那句话（或一条由 `--run` 采到条数的命令）；清单上不再出现「这条没配命令核过」的批注；剩下的数字与当天跑出来的一致；改完由审查者复核
  理由：六条记录都在已封存的 S02.19 里（closedAt 2026-11-25T04:52），账本只追加、封存段一分也不让改；重开那一段要整段 57 条重判，代价远大于六句话。它要的机制已经在了：清单上「只是说法」的标注还在，新的交付记录能带 run 与 expects
- [~] T90 在面板上确认议题后才拆任务，命令行不开放这个动作
  依据：2026-11-24 用户轮「讨论机制按议题来…冲突拆成题」
  标准：面板在「题全关 + 正文非空 + 至少一轮」时显示按钮，其余时候不显示；POST /topic/release 只收 127.0.0.1 且同源，落 {k:"topic.release", by:"user", via:"panel"}；cli/spec.mjs 里没有 topic release 这条，任何 --via 自称都不认；有用例覆盖闸与拒绝
  理由：「题」这个对象已经随 T89 一起删了（讨论变成原文→要点→议题三层），标准里的「题全关才出按钮」没有了对象；议题出口那道闸本来就在面板上按——今天落的 topic.release 就是 by:user via:panel
- [~] T92 面板 /events 的客户端断开后，服务继续运行
  依据：2026-11-24 用户轮「讨论机制按议题来」后的面板稳定性讨论
  标准：board/serve.mjs 的 /events 有 res.on("error") 与写失败处理；客户端连一次再断开之后进程仍活着（探针记 pid 前后一致）；有用例或可复跑的命令
  理由：这条要的行为已经在了，而且换了做法：/events 的连接现在由 streams 计数护着，开着页面不会被当闲置收走，board 里有两条用例钉住（开 SSE 超闲置线不退、没连接按闲置退）
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

## 段 S02.21
<!-- 还没轮到：现在收活的是 S02.20，轮到了这一段才收交付 -->
<!-- 在做（1 条）：只做这一条，做完立刻勾上，再动下一条 -->
- [ ] T154 审查结论落下之后自动把作者叫回来
  标准：账本尾巴上出现 review.log／verdict.pass／review.overturn／sign／segment.seal 时，适配器以一条 source.kind 不是 user 的跟进消息在作者会话里开一轮（正在跑就排到下一轮）；第一次只记水线，重载不重播旧结论，同一条只叫一次；有用例直接驱动这三条（没结论不叫、落了叫一次、第二次不再叫；正在跑走 next-turn；几条一起落只开一轮）

