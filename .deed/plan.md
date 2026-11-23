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

## 段 S02.7
- [x] T44 整期审那条用例站在顶层，父用例自己的收尾留在父用例里
  标准：test/rules.test.mjs 里「a segment a reviewer read counts…」是顶层 test；它上面那条 seal 用例在 :293 之后自己收口（signBlockers 与 nextAction 断言都在同一个 test 里）。变异核对：把 read 那行改成 false && …，只有这一条用例红（18 过 1 败），不是把父用例一起带红。
  交付：test/rules.test.mjs 里那条 seal 用例在 :293-295 自己收口（signBlockers 与 nextAction 断言都在同一个 test 里），「a segment a reviewer read counts…」提到顶层、夹具自己建（:297-315）；原来收尾断言被挤在新用例之后，一次变异会把两条用例一起带红。跑的是这一份字节：node --test 154/154、node --test test/rules.test.mjs 19/19。变异核对（TEMP 副本把 core/rules.mjs 的 read 改成 false && …）：18 过 1 败，红的只有新用例，父用例不再跟着红。
- [x] T45 文档只说 deed seal 封过的段不再重算规模，被 pass 封的段照样重算
  标准：docs/DESIGN.md 的 §6 规模那条与 §12.4 边界段都改写成「`segment.seal` 封过的段不再重算规模」，并说清被审查者 pass 封的段照样重算、结局由结论决定（reviewState / needsWhole 按「有没有人看过」短路）。
  交付：docs/DESIGN.md §6 规模那条改成「`segment.seal` 封过的段不再重算规模」，并说清被审查者 pass 封的段照常重算、结局由结论决定（reviewState 认有效的 pass，needsWhole 认有没有人看过）；§12.4 的边界段同改，另加一段说「needsReview 的返回值不等于结局，要读结局读 reviewState 与 signBlockers」。跑的是这一份字节：node --test 154/154、node --test test/docs.test.mjs 4/4。

## 段 S02.8
- [x] T46 seal 那道守卫有称过字节的夹具，不靠「没称字节」那条路顺带被覆盖
  标准：test/rules.test.mjs 里 seal 封段的用例含一段交付称过 92160 字节、被 `segment.seal` 封住，断言 needsReview 为 false；变异：删掉 core/rules.mjs 的 sealedBy/closedAt 守卫，这一条必红。
  交付：test/rules.test.mjs 的 seal 用例里，第一条交付改成 changed=[docs/a.md] + bytes {docs/a.md: 92160}（第二条 100 字节），用例注释写明「没有那道守卫它就该被审」，所以这条守的是守卫本身而不是「没称字节一律要审」。跑的是这一份字节：node --test 154/154、node --test test/rules.test.mjs 19/19。变异核对（TEMP 副本删掉 core/rules.mjs 的 `if (segment?.sealedBy && segment.closedAt !== null) return false;`）：18 过 1 败，红的正是这条。
- [x] T47 文档写清那道守卫的两个条件
  标准：docs/DESIGN.md §12.4 那句「segment.seal 封过的段返回 false」改成同时说明 sealedBy 与 closedAt 两个条件都在才豁免，并说明手改账本造出半个封存不在守卫范围（属「不许做」）。
  交付：docs/DESIGN.md §12.4 改成「判的是 sealedBy 与 closedAt 两个都在（账本上真写下过一次封存），不是一句 why」，并说明手改账本造出半个封存不在守卫里、属于「不许做」而不是「挡得住」。跑的是这一份字节：node --test 154/154、node --test test/docs.test.mjs 4/4。

## 段 S02.9
- [x] T48 守卫的两半各有测试看着：pass 封的段照样重算，seal 少了 closedAt 就不算封过
  标准：test/rules.test.mjs 里有 pass 封段 + 92160 字节断言 needsReview 为 true 的用例；seal 用例断言 sealedBy 在、closedAt 缺时不算封过。变异核对：守卫只留 closedAt → 红的；只留 sealedBy → 红的；整条删掉 → 红的。
  交付：test/rules.test.mjs 新增「a segment a reviewer passed is still weighed, so the exemption is only for a seal」（pass 封段 + 92160 字节 → needsReview true、reviewState 仍是 pass）；seal 用例补断言「{ ...first, closedAt: undefined } 不算封过」。跑的是这一份字节：node --test 155/155、node --test test/rules.test.mjs 20/20。变异核对（TEMP 副本）：守卫只留 closedAt → 19 过 1 败（红的是新用例）；只留 sealedBy → 19 过 1 败（红的是 seal 用例）；整条删掉 → 19 过 1 败。三处各有用例看着。
- [x] T49 守卫读的是真值，文档与它逐字一致
  标准：core/rules.mjs 的守卫写成 sealedBy 与 closedAt 都是真值（不再是 closedAt !== null）；docs/DESIGN.md §12.4 那句话写成「两个都是真值……不是这个字段存在就算」，并说明半个封存照常按门槛重算。
  交付：core/rules.mjs 的守卫改成 `if (segment?.sealedBy && segment.closedAt) return false;`（原来 `closedAt !== null` 把 undefined 也算在，半个封存会被豁免）；docs/DESIGN.md §12.4 那句写成「判的是 sealedBy 与 closedAt 两个都是真值……不是这个字段存在就算」，并说明半个封存照常按门槛重算。跑的是这一份字节：node --test 155/155、node --test test/docs.test.mjs 4/4、node --test test/rules.test.mjs 20/20。
- [x] T50 seal 用例的门槛与内核默认值解耦
  标准：test/rules.test.mjs 的 seal 用例用自己声明的 review.size（bytes 1000）跑，92160 靠这条声明判「大」，不再依赖默认的 20000；把这条声明去掉后用例仍然红得起来（守卫删掉时），改大内核默认值不会让它无声失效。
  交付：seal 用例改用自己声明的门槛 `const tight = { ...config, review: { ...config.review, size: { bytes: 1000 } } }`，92160 靠这条声明判「大」，不再依赖内核默认的 20000；断言把 config 换成 tight。跑的是这一份字节：node --test 155/155、node --test test/rules.test.mjs 20/20。这条用例现在守两件事（92160 + tight 时只有封存守卫能为它豁免；以及 closedAt 缺失不算封过），所以变异时可能因为任一半而红：把 92160 改回 100 并删掉守卫，它仍然 19 过 1 败，红的是 closedAt 那半。

## 段 S02.10
- [x] T51 文档说出半封存的真实来路，并有用例钉住它
  标准：docs/DESIGN.md §12.4 不再说「这种形状只有手改账本能造出来」，改成 real 路径（整期审 fail 退回 deed seal 封过的段里的一条，core/fold.mjs 的 fail 分支把 closedAt 清成 null、sealedBy 留着）确实会造出它；test/rules.test.mjs 有一条用例按这条路径折出来，断言 needsReview 为 true。变异：把守卫改成只看 sealedBy，该用例必红。
  交付：docs/DESIGN.md §12.4 删掉「这种形状只有手改账本能造出来」，改成真来路：整期审不合格、把 deed seal 封过的段里的一条点回来时，core/fold.mjs 的 fail 分支留着 sealedBy、把 closedAt 清成 null；test/rules.test.mjs 新增「a whole-period rework reopens a sealed segment, and that half-seal is weighed again」按这条路径折出来（T1 在 core/a.mjs 上交付、段被 segment.seal 封、再落一条 scope=session 的 fail 点名 T1），断言 sealedBy 还在、closedAt 为 null、needsReview 为 true。跑的是这一份字节：node --test 157/157、node --test test/rules.test.mjs 21/21。变异核对：把守卫改成只看 sealedBy → 2 条红（含这条新用例）；只看 closedAt → 1 条红；整条删 → 1 条红。
- [x] T52 submit 不替人写一条没有内容可指的交付
  标准：清单勾上但这一批既没改动也没有可指的文件时，deed submit exit 1 并说清怎么办（先真的动过，或 deed task done --digest 手工指）；账本一条不落。测试：这种形状 submit 被拒且 kinds 不变。
  交付：cli/deed.mjs 的 submit 在落 task.done 前检查 pins：这一批既没量到改动、也没有文件可指时 exit 1，报「先真的动过再勾，或者用 deed task done --evidence \"…\" --digest <文件> 手工指那份内容」，一个字都不落。test/cli.test.mjs 新增「a submit with nothing to point at refuses to write the delivery」（先落一条新条目，再勾上但不改任何文件 → submit exit 1、事件条数不变）。跑的是这一份字节：node --test 157/157、node --test test/cli.test.mjs 88/88。
- [x] T53 seal 用例显式断言两个字段都在
  标准：test/rules.test.mjs 的 seal 用例里有 assert.equal(first.sealedBy, "agent") 与 assert.notEqual(first.closedAt, null)，不再是只靠豁免断言转述。
  交付：test/rules.test.mjs 的 seal 用例补上显式断言：assert.equal(first.sealedBy, "agent") 与 assert.notEqual(first.closedAt, null)，不再只靠 needsReview 的豁免断言转述；旁边那句注释也从「这种半个封存只有手改账本造得出来」改成说清真来路（整期审的 fail 分支留着 sealedBy、把 closedAt 清成 null）。跑的是这一份字节：node --test 157/157、node --test test/rules.test.mjs 21/21。变异核对：守卫改成只看 sealedBy → 2 条红（seal 用例外加新用例），只看 closedAt → 1 条红，整条删 → 1 条红。

## 段 S02.11
- [x] T54 面板跟着命令自己起，不占终端，30 分钟没人连就退
  标准：任意一条 deed 命令执行前探测面板，不在就用后台进程拉起并把 URL 打印在那一行；下一条命令不再重复起；30 分钟没有请求自己退出；DEED_NO_PANEL=1 时一条都不起；deed panel 看状态、--stop 立即停；它不写账本。测试要真起一次、再确认第二次不起，并把这两种行为各用一条用例管住（去掉自动起那几行要红）。
  交付：node --test 134/134（这一份字节）；变异：关掉 dispatcher 里的 ensurePanel 那一行，panel 用例红一条。实测：init 后第一条 tick 打印「面板 · http://127.0.0.1:2770」，第二条 state 不再打印，deed panel 报出端口与 pid，--stop 停掉后 state 又起 2990。
- [x] T55 只删不钉的交付不被 submit 误拒
  标准：工作区差里有删除、没有可钉的现存文件时，deed submit 照常落交付（files 为空、changed 记下那条路径），不再报「没有量到任何改动」；确实什么都没动时仍然拒。测试：只删一份文件的场景 submit exit 0 且 changed 里有它；空场景仍被拒且零写入。
  交付：node --test 134/134；变异：submit 的拒绝条件退回只看 pins，删除用例红一条（报「没有量到任何改动」）。实测：只删 gone.md 的那一批 submit exit 0，事件里 files 为空、changed 有 gone.md。
- [x] T56 空交付在 verify 里看得见，即使后来被覆盖或撤回
  标准：deed verify 报出每一条指不到任何内容的交付（files 与 changed 都空）与每一条没记下被撤内容的撤回，即使它已不是现行交付、或已被重交盖住；文案说清「后来重交过，不挡放行」，不改变退出码。test/cli.test.mjs 有两条来路各一条断言。
  交付：node --test 134/134；变异：bareHistory 里撤回那条来路清空，bare-history 用例红一条。实测：verify exit 0 并打出「空交付 · T1 · … 那时没记下文件 … 不挡放行」与「空交付 · T2 · … 撤回时没记下内容 …」。
- [x] T57 撤回记下被撤那条记了哪份字节
  标准：task.undo 落到账本的那条带上 undoes（被撤那条的 files 或 digest/path），撤回行在审查清单里显示「它当时记下的是 <路径> <sha 前 12 位>」；没记下内容时显示「它当时没有记下任何内容」。测试断言账本里 undoes 的 path 与清单里的那句话。
  交付：reviewer:s2-r21 判未达成，理由是主路线而不是动词路线：清单里把勾去掉 + 理由，submit 落的 task.undo 原始行没有 undoes。现在两条入口共用一个 undoesOf（cli/deed.mjs），落账那一行自己带着被撤的 path 与 sha256；core/events.mjs 的形状校验与 core/fold.mjs 的优先读各有用例（原先两处变异全绿）。node --test 137/137（cli 67、fold 23）；变异三处：删 submit 的 undoes 字段 / 关掉形状校验 / 去掉优先读，各自红一条且原样还原。

## 段 S02.12
- [x] T58 27 条被覆盖掉的用例回到文件里，跑得通
  标准：test/cli.test.mjs 里 8b3e6dc 有过的 27 条用例都在，逐条通过；用例数从 65 回到 94 以上。
  交付：从 8b3e6dc 取出 test/cli.test.mjs 的 27 块原样贴回，node --test test/cli.test.mjs 94/94（65 → 94），再补两条删除用例 → 96/96；跑的是这一份字节：node --test 166/166。
- [x] T59 删掉的文件不算小改动，只删东西的交付也不再欠「记下一个文件」
  标准：交付那一刻不给删掉的路径记 0 字节（bytes 里没有它），门槛对动过却称不出的路径判要审；只删东西的交付在签收清单上不欠「记下文件」。task done 与 submit 两条入口都有用例，删掉守卫就红。
  交付：cli/deed.mjs 两条交付入口（task done 与 submit）都不再给删掉的路径记 0 字节；core/rules.mjs 的 needsReview 增一条「动过却称不出的路径 → 要审」；unpinned 改成看现行交付，只删东西的交付不再算悬空（签收差里不再出现「记下一个文件」）。跑的是这一份字节：node --test 166/166（test/cli.test.mjs 96/96）。变异五处各自红并原样还原：done 记 0 / submit 记 0 / 守卫拿掉 / unpinned 退回 digest+path / pointsAtNothing 忽略 changed。
- [x] T60 「什么也没指着」只有一处定义，audit 与规则共用
  标准：core/rules.mjs 导出 pointsAtNothing，cli/audit.mjs 不再自带一份；删掉一个文件算「指着它动过的那条路径」，不算空交付。改动被用例管住（把它改回只看 files/digest 要红）。
  交付：core/rules.mjs 导出 pointsAtNothing（files 空、且没有 digest+path、且 changed 空），unpinned 用它判现行交付；cli/audit.mjs 删掉自带的那份、改为 import。跑的是这一份字节：node --test 166/166；变异：把 pointsAtNothing 的 changed 那半去掉，删除用例红一条（还原后 96/96）。

## 段 S02.13
- [x] T61 注释与设计不再跟代码说反话
  标准：core/rules.mjs 里那条说「称不出的按 0 字节，假装它大就会把所有老交付拉去审」的注释改成讲真话（0 只用于求和，说不清多大的由守卫判要审）；docs/DESIGN.md 里空交付那句把撤回那条来路归还给 bareHistory。
  交付：core/rules.mjs 的 task_size 上面那条注释改成讲真话（求和时说不清的按 0，放不放行由 needsReview 的守卫说）；docs/DESIGN.md 里空交付那句把「撤回时没记下被撤的内容」归还给 cli/audit.mjs 的 bareHistory。跑的是这一份字节：node --test 167/167。
- [x] T62 pointsAtNothing 的语义有一条直接用例
  标准：test/rules.test.mjs 里有用例直接断言 pointsAtNothing 对五种形状的回答（什么都没指、老形状、只删了一条路径、钉了内容、钉了一组内容）；把那半守卫改回只看 files/digest 会红。
  交付：test/rules.test.mjs 新增一条用例，直接断言 pointsAtNothing 对五种形状的回答（{}、files/changed 都空、只有 changed、有 digest+path、有一组 files），把那半守卫改回只看 files/digest 时它变红（跑过：rules 22 条里 1 条红，还原后 22/22）。跑的是这一份字节：node --test 167/167。

## 段 S02.14
- [x] T63 空交付的形状在文档里写全，空输入也有回答
  标准：docs/DESIGN.md 的空交付那句写清「钉了内容就不算空」；pointsAtNothing(null) 返回 true 且有用例断言；改回去要红。
  交付：docs/DESIGN.md 的空交付那句补上「钉了内容就不算空」（哪怕那条路径后来没了）；pointsAtNothing 收下空输入（还没交付时也算什么都没指），test/rules.test.mjs 加一条断言；去掉空输入那一半时 rules 22 条红 1 条（还原后 22/22）。跑的是这一份字节：node --test 167/167。

## 段 S02.15
- [x] T64 HANDOFF 的现状段跟上账本，r26 的两条观察记在「没做的」里
  标准：HANDOFF 现状段说的是账本此刻的样子（14 段已判过、等整期审）；「没做的」列出那两处（三处判空的调用点没有用例、半个指纹的字面口径）。
  交付：HANDOFF 现状段改成账本此刻（14 段全判过、整期审已过期待重出），「没做的」加两条（三处判空的调用点没有用例、半个指纹的字面口径），下一步改成先整期审再签收。只动 HANDOFF.md，跑的是这一份字节：node --test 167/167。

## 段 S02.16
- [x] T65 HANDOFF 里那句用回了通行词
  标准：docs 的禁词检查 4/4 通过，全量测试不再有红；HANDOFF 那句说的是同一件事。
  交付：HANDOFF「没做的」两处改用通行词（「没有用例看着」「字面上却算记下了内容」），node --test test/docs.test.mjs 4/4；全量 node --test 167/167。

## 段 S02.17
- [x] T66 整体审以段为单位：材料列各段的结论，打回点名段
  标准：整期材料只列每段的结论（谁、何时、判定、发现、退回的段），不重列段里的条目；整体审的 --rework 只认段号，被点名的段整段重开，段里的条目保持交付；DESIGN §12.6 与 HELP 说同一件事；node --test 全绿
  交付：整期材料改成每段一行（谁判的、什么时候、判定、几条发现、退回的段）+ 各段发现 + 延后/放弃/待裁，段里的条目不重列；整体审的 --rework 只认段号，被点名的段整段重开、旧结论留史作废、条目保持交付，点条目在 core/fold.mjs 就被拒；这条规则落在事件含义第 9 版，旧行照旧读；DESIGN §12.6 与 §8、HELP 两行、HANDOFF 同口径。跑的是这一份字节：node --test 169/169（96 CLI），docs 4/4；变异四处各自红并还原。

## 段 S02.18
- [x] T67 命令面一动词一个文件，开关只留一张表：拼错的开关被拒
  标准：cli/verbs/ 里每个动词一个文件；cli/spec.mjs 是唯一那张表，解析与 --help 都从它出；不认的开关 exit 1 并猜最接近的一个；全量测试全绿
  交付：node --test 170/170（97 条来自 CLI，其余 73 条）；拼错的开关当场被拒：deed task done T1 --evidence x --digset a.md → exit 1「deed task 不认 --digset 这个开关：是不是 --digest？」；review --help 只打自己那几行
- [x] T68 事件含义变成一张表，写盘时带 v：没带 v 的旧行按第 1 版读
  标准：MEANING 与 meaningOf 在 core/events.mjs；写盘方显式带 v；doctor 逐行检查仍按每行自己的版本；有用例钉住旧行按旧标准读
  交付：node --test 170/170；test/version.test.mjs 5/5（旧行按旧标准读、含义超前说「升级」）；deed doctor 逐行检查按每行自己的版本，账本 exit 0
- [x] T69 删掉迁移壳、按名字落账、把自造词换掉
  标准：judge 只剩 --overturn，--pass/--rework 不认；ask resolve/withdraw 走 signer；仓库与文档里不再有「材料」这个绰号（「过程材料」除外）
  交付：node --test 170/170；deed judge --pass → exit 1（judge 不认 --pass）；deed ask resolve … 从管道里跑缺 --by 被拒；全仓 grep「材料」只剩「过程材料」三处（AGENTS、docs/README、docs/research）
- [x] T70 面板守住工作区写的端口，代码换过就自己换进程，不必有人记得重启
  标准：端口取自门槛（默认 7317）；被占时退回系统给的号并说清；记号里带面板代码的指纹，对不上就换进程；地址在重启前后一致
  交付：node --test test/cli.test.mjs 98/98（新增条：端口取自门槛、停掉再起同一地址、指纹对不上就换进程且端口不变）；node --test board/board.test.mjs 9/9

<!-- 勾上 = 交付（写 交付：一行）；取消勾选 = 撤回（写 理由：）；? = 新条目；~~ = 放弃（写 理由：）。改完 deed submit -->
