# 这一期要做成什么
把操作面收成一个清单文件：写清单、deed submit 一次落账；要不要审看规模。

## 段 S02.1
- [x] T21 清单一个文件：deed plan 出草稿、deed submit 整批落账
  标准：清单里 ? 领号并写回清单；勾上 = 交付，sha256 由工作区快照自己算；取消勾选 = 撤回；~~ = 放弃；任何一行不合格整批拒且账本零新增
  交付：node --test test/cli.test.mjs 77/77、test/plan.test.mjs 6/6；npm test 138/138；deed plan 出草稿、deed submit 领号并写回清单（T21..T23 就是这么落的）；坏行整批拒且账本零新增；只加条目的一次 submit 不再刷新基线（新用例 adding an entry does not swallow the changes waiting to be delivered）
- [x] T22 要不要审看规模：文件数、字节数、跨了几个顶层目录
  标准：规模三条进 needsReview（默认 5 个文件、20000 字节、跨三个以上顶层目录要审）；没称过字节的交付不按大改动算
  交付：node --test test/rules.test.mjs 16/16：2 份小文档免审、6 个文件要审、单份 30000 字节要审、跨三个顶层目录要审；test/cli.test.mjs 的 a delivery weighs what it moved 通过
- [x] T23 三条审查观察的治本：名字措辞、免审期的整体审、禁词检查守 AGENTS.md
  标准：seal 不带 --by 的报错说「没有写名字」；一期各段全免审时不需要整期结论；docs 测试同时守 README 与 AGENTS.md 的粘块并扫禁词
  交付：node --test test/docs.test.mjs 4/4（README 粘块、AGENTS.md 尾段、禁词表）；test/rules.test.mjs 的 a period whose segments all sat out review needs no conclusion on the period 通过

## 段 S02.2
- [x] T24 一批交付要说明改动属于整批
  标准：同一批里的多条交付记同一个批号；清单说清这一批几条；单条一批不写批号
  交付：批号改成 { at, size }：时刻是这一批落账的同一刻，size 是这一批原本几条（撤回同批一条后清单仍说得出「共 N 条（其中 M 条已撤回）」，不再拿剩下的条数现算）。核：node --test test/cli.test.mjs 86/86，含新用例 taking one delivery back does not shrink the batch it belonged to 与 one submit that delivers several entries says the changes belong to the batch（断言 batch.size === 2）
- [x] T25 门槛说不用审的一期，出整体审材料前先说明不需要
  标准：deed review --all 在一期各段都免审时先打印一句「不需要整期结论」，仍允许出一份
  交付：deed review --all 在一期各段都免审（needsWhole 为假）时先打印「这一期的各段都免审……不需要整期结论」，仍允许出一份。核：新增用例 a period with nothing to review is told it needs no whole conclusion 通过；npm test 140/140
- [x] T26 面板：没声明路径的条目不再印成没内容
  标准：submit 建的条目 files 为空但交付记下了路径时，卡片说的是交付记下几个，不再写未声明路径；同批交付有标记
  交付：面板：submit 建的条目 files 为空、但交付记下了路径时，卡片印「没声明路径 · 交付记下 N 个」；同批交付带「同批」标记。核：npm test 的 board 9/9 通过；7317 页面重开看过
- [x] T27 批号要记下这一批几条，撤回后数目不变
  标准：submit 落多条交付时事件里带这一批的条数；清单在撤回同批一条后仍说得出原本几条、几条已撤回；单条一批不写同批行
  交付：task.done 的 batch 改记 { at, size }（core/events.mjs 校验 task.done 的 batch 必须是 at + 不少于 2 的 size；core/fold.mjs 把旧字符串批号归一成 { at, size: null }，task.undo 把批号带进 undone）；cli/brief.mjs 用 batchInfo 记账，撤回后仍说「这一批共 N 条（其中 M 条已撤回）」，单条一批不写这行。核：test/cli.test.mjs 86/86，含 plan-batchmark 与 plan-batchundo
- [x] T28 整期结论判了不合格，签收也要挡住
  标准：一期存在未作废的整体审不合格时 signBlockers 挡住签收并给出重出或推翻的命令；state 与面板说法一致
  交付：signBlockers 增一条——一期若有一条未作废的整体审不合格，签收被挡，说明要重出一份通过的或由人推翻（给 judge --overturn 命令）。免审的一期也一样挡。核：新增用例 a standing whole-period failure still blocks the signature 通过
- [x] T29 免审那句提示排到检查之后
  标准：一期还有段没封或缺目的时 review --all 只报缺什么，不打印「各段都免审」；全免审且三项检查都过才打印
  交付：deed review --all 的「各段都免审」提示挪到「目的／未封段／待交付」三项检查之后——先报缺什么，才说需不需要整期结论。核：新增用例 the exempt notice waits until the checks it talks about are through 通过（段没封时 exit 1 报「还有段没封」，且不打印那句）
- [x] T30 tick 的 agent 轮不许抄用户原话
  标准：tick --who agent 时 --said 与最近一条 user 轮的 --said 逐字相同就拒绝并说明该记什么；user 轮不受影响
  交付：tick --who agent 时把 --said 与最近一条 user 轮逐字比，相同就拒并说明该写自己说的话；user 轮不受影响。核：新增用例 an agent turn cannot repeat the user's words as its own 通过（被拒的那轮不落账）
~~ T31 doctor 用提交时刻查承诺晚于工作
  标准：deed doctor 对每条现行交付钉的文件查最后一次提交时刻，早于该任务的承诺时刻就列出来（只报事实，不算坏账）；没有 git 的目录跳过不报错
  理由：提交时刻总在任务被记下之后，拿它比永远看不出「先做后记」；改成按文件最后写入时刻查，另立一条
- [x] T32 同一批 submit 不许既新增又交付
  标准：一次 submit 里同一条既 ? 又勾上交时整批拒，说明先落承诺再做；分两批则通过
  交付：submit 见到「新条目（?）与勾上（[x]）同一次」就整批拒，说明先把条目写成任务、做完再勾；整批零写入。核：新增用例 an entry that is new cannot be ticked in the same submit 通过
- [x] T33 清单把已判过的条目画成未勾选
  标准：deed plan 重出的草稿里已封段中判过的条目保持勾上；再 submit 不会给已判过的条目重复落交付
  交付：cli/plan.mjs 的草稿把 done 与 accepted 都画成 [x]，判过的条目不再显示成未勾。核：新增用例 the draft keeps judged entries ticked 通过
- [x] T34 doctor 按文件最后写入时刻查「先做后记」
  标准：deed doctor 对每条现行交付钉的文件查最后一次写入时刻，早于那条任务被记下的时刻就列出来（只报事实，不算坏账）；没有 git 的目录跳过不报错；clone 出来的工作副本 mtime 全是检出时刻，安静不报
  交付：整期审退回 T34 的三件事补完：HANDOFF 的现状段改到账本当前状态（两段都判过、整期审不合格在案），材料指针不再写死文件名、改成看 .deed/review 下最新的那一份，这两种指针都不会过期；T34 只留这一条记录，钉的是已提交的字节（b8ccd22），先跑测试再写字、写完没再动文件。这一份字节上 npm test 147/147、node --test test/cli.test.mjs 86/86；下一份整期材料重出后再由审查者判
- [x] T35 材料交出去之后，下一步说「落结论」而不是「另出一份」
  标准：段或整期的在案结论已经旧了、但新材料是改动之后发出且还没人回答时，deed state 与面板给的下一步是「落结论」（带 --verdict pass），不再是「另出一份」；材料旧了才叫另出
  交付：core/rules.mjs 新出 freshBrief / freshWholeBrief：材料发出去之后这一段（或这一期）没再动过、也还没人回答，才算新鲜。原来「结论过期」与「不合格还在案」两个分支只看到手上有材料、没看它是不是改动之后发的；现在两处都先问新鲜度，整期材料那一步同样。面板与 state 同源，不用改。核：node --test test/rules.test.mjs 17/17——新增 a brief handed out after the last change is answered, not replaced，同一场景先断言「重审」、材料发出后断言「落结论」且命令带 --verdict pass，另断言整期材料被回答后不再算新鲜；npm test 148/148 跑在这一份字节上

## 段 S02.3
- [x] T36 HANDOFF 的现状段与下一步跟着账本走
  标准：HANDOFF 第 8 行的段内容与实际条目一致（S02.2 是 T24..T35，已由 reviewer:s2-r7 于 11-23 21:18 判过）；下一步段只写还没发生的事——T34 已交付、材料已发，不得再列为待办；材料指针仍是「看 .deed/review 下最新的那一份」，不写死文件名
  交付：第 8 行的段内容改成在案结论 R10 · reviewer:s2-r11 · 21:55 退回 T36（R9 已被它作废、T37 通过），并写明两条一起重新交付、等新材料的结论；S02.2 那半仍是 T24..T35、r7 21:18 判过。验证行改 150/150（86 条 CLI + 其余 64），跑的是这一份字节：npm test 150/150（fold 21）、docs 4/4。下一步段只写还没发生的事：材料指针仍是「.deed/review 下最新的那一份」。
- [x] T37 退回一条交付时，它碰过的路径也跟着退回
  标准：重放里 rework 把一条交付退回未做时，那条交付记下的 changed 路径不再留在任务上（退回之后这一段碰过的路径只由还在的交付算出来）；新账本与旧事件重放两条路都成立；有测试钉住「退回之后同一个免审批次不再被判要审」
  交付：rederive 现在把交付记下的 files 也算碰过：touched = [...(proof.changed ?? []), ...(proof.files ?? []).map(one => one.path)]，手工 --digest 的交付（changed 为空）因此不再让门槛失明。test/fold.test.mjs 三条断言：退回当场 task.changed 为空且 sizes 归零；退回后再交只剩新路径；只带 --digest 的交付照样判要审。test/rules.test.mjs 的免审夹具改成交付钉住自己那条 exempt 路径（原来钉 core/fold.mjs，属于夹具与场景不符）。跑的是这一份字节：node --test test/rules.test.mjs test/fold.test.mjs = 38/38；npm test 150/150（fold 21 · rules 17）。

## 段 S02.4
- [x] T38 退一条交付的后路都有断言：撤回与推翻结论后点名重做，两处也会让路径归零
  标准：把 core/fold.mjs 的 task.undo 分支或 judge.rework 分支里的 rederive 删掉，test/fold.test.mjs 立刻红；不改变现有行为
  交付：test/fold.test.mjs 新增一条用例：撤回之后 task.changed/sizes 归零、人点名重做之后同样归零。变异核对：把 core/fold.mjs 的 task.undo 分支里的 rederive 删掉，用例在撤回那一半红；把 judge.rework 分支里的删掉，在重做那一半红；现有行为不变。这条字节上 node --test test/fold.test.mjs test/rules.test.mjs test/cli.test.mjs = 126/126，npm test 152/152。
- [x] T39 HANDOFF 第 8 行把 r11 指出的处数说对
  标准：第 8 行写的处数与账本 R10 的 findings 条数一致（是三处，不是两处），读者照它找不会少一处
  交付：第 8 行改成「`reviewer:s2-r11` 21:55 退回 T36 时指出三处…」，与账本 R10 的三条 findings 逐条对上（第 8 行的在案结论过时、门槛看不见只带 --digest 的交付、调用点数目写成三处）；同句补上 S02.3 已由 reviewer:s2-r12 22:11 放行封段、S02.4 三条等结论。验证行改 152/152（86 条 CLI + 其余 66），跑的是这一份字节：npm test 152/152。
- [x] T40 称不出规模的交付默认按要审
  标准：交付记了路径却没称字节时，门槛判这一段要审而不是按 0 字节放行；有测试钉住这条默认值
  交付：core/rules.mjs：needsReview 增一条——交付自己记下的文件没称过字节就是「说不清多大」，按要审算（只声明过、这次没交付到的路径不算）；sizeOf 另报 unknown。cli/deed.mjs：task done 记 --digest 时当场称每一份（pinSizes → bytes），那几份常常这次没动过、不在工作区差里。docs/DESIGN.md §6/§12.4 与 §12.3 同步。测试：test/rules.test.mjs 旧「没称过不算大」改成「没称过不算小」并断 true，免审夹具的交付带上字节；test/cli.test.mjs 新增「重钉一份这次没动的文件也当场称」。跑的是这一份字节：node --test test/cli.test.mjs test/rules.test.mjs test/fold.test.mjs = 126/126；npm test 152/152。

## 段 S02.5
- [x] T41 HANDOFF 里的数与首句跟着这一份字节走
  标准：验证块里的条数与拆分在交付的这份字节上跑出来就是它写的数（CLI 与其余分开写清）；状态段首句与同段后半句不矛盾，说的是账本此刻的样子
  交付：HANDOFF.md 验证块改成 153/153、87 条来自 CLI 端到端、其余 66 条，cli 87/87；状态段首句改成「五段里四段已判过」，四段各自写了谁在哪一刻放行，并补上 S02.4 的四条发现与 S02.5 在做；下一步段重写（先出 S02.5 清单、再 deed review --all、然后停等签收）。跑的是这一份字节：node --test（全量）153/153、node --test test/cli.test.mjs 87/87、node --test test/docs.test.mjs 4/4。
- [x] T42 用 deed seal 封过的段，不再被后来的规模规则追溯判要审
  标准：封存那一刻的决定留在账本上，后来把门槛写细不回头改写它——needsReview 对已封存的免审段返回 false，needsWhole、signBlockers、面板标签三处跟着一致；有测试钉住这条
  交付：core/rules.mjs 的 needsReview 开头先看这一段是不是 segment.seal 封的（sealedBy 有值且 closedAt 非空），是就返回 false——规则只管还开着的段；needsWhole、signBlockers 的未钉检查、reviewState 都从它出，三处一起对齐；docs/DESIGN.md §6 与 §12.4 各写一句为什么。测试：test/rules.test.mjs 新增「a segment sealed before the gate got stricter is not pulled back into review」（两段都用只带 --digest、不称字节的老形状交付封成免审 → needsReview false、reviewState exempt、needsWhole false、签收无债、下一步签收）。跑的是这一份字节：node --test 153/153（rules 18/18）。变异核对：把那行守卫改成 false && …，那条用例红、其余 17 条不动。

## 段 S02.6
- [x] T43 整期审的判法说出本意，账本层的边界写清楚
  标准：needsWhole 不靠重算已封存段的规模来决定「这一期要不要整期审」——审过的段算数、deed seal 的段不算；docs/DESIGN.md 那两处话与代码一致，并写明账本层为什么不重查门槛；HANDOFF 的「没做的」列出这两条边界与理由
  交付：core/rules.mjs 的 needsWhole 改成 read(one) || owed(one)（read = 这一段有审查者的 pass，owed = 不是免审且门槛要审），不再拿已封存段的字节重量重算；docs/DESIGN.md §12.4 那段改成「规模规则只管还开着的段」并补一句「要不要整期审只看有没有人看过它」，§6 的规模那条跟着改，§8 新增「账本层不重查门槛」一段（fold 只拒自相矛盾的事件，该审的段封不了由 sealBlockers 挡，拿今天的门槛核历史行会把合法历史判成坏账）；HANDOFF 新增这一轮一节、「没做的」列上这两条边界与其理由、下一步改到 S02.6 与 deed review --all。测试：test/rules.test.mjs 新增「a segment a reviewer read counts for the whole review, whatever its deliveries weigh later」（一段很小被 pass 封住、一段 deed seal 封住 → 前段 needsReview false 而整期审仍要有结论）。跑的是这一份字节：node --test 154/154（rules 19/19）、node --test test/docs.test.mjs 4/4（它在改完 HANDOFF 之后跑的）。变异核对：把 read 那行改成 false && …，rules 立刻 2 条红（17 过 2 败），还原 19/19。

<!-- 勾上 = 交付（写 交付：一行）；取消勾选 = 撤回（写 理由：）；? = 新条目；~~ = 放弃（写 理由：）。改完 deed submit -->
