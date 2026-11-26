# deed · DSH 适配器

把 DeepSeek Harness 里真实发生的事交回工作区的账本。它只做三件机械的事，一个判断都不做：

| 做什么 | 怎么记 | 账本里读得到什么 |
|---|---|---|
| 原文（两边） | 人说的：`user/message` 且 `source.kind === "user"` → `deed say --from dsh:<会话>:<消息号>`；我说的：`assistant/message` 的文本块 → `deed reply --from …`（文本都走 stdin） | `turn` 与 `reply` 各记 `via:"hook"`，同一个消息号只记一次；子代理会话两边都不记 |
| 惯例 | `turn/start` 时置位，第一个模型步的 `agent/pre-step` 注入一次 `<system-reminder>`（`source.kind:"deed-reminder"`）：这一轮留下什么判断就记成要点 | 账本上不写一行——它是环境规则，不是人说的话；子代理收不到 |
| 审查 | `task.done`／`turn/start` 时问 `deed review --due`；要清单就先 `deed review --auto` 出清单与角色包，然后起一个审查者（同一个段复用同一个，期审每次新开） | `review.brief` 记 `via:"auto"`；结论由审查者自己敲 `deed review --verdict` 记账 |

## 边界（在代码里，不在文档里）

- 钩子里任何异常都吞掉，写不进去就丢：适配器不能把这一轮带下来。
- 不读也不改宿主配置，不替人装东西。
- 不写三道人闸（签收、判决、议题出口）：那些只有人在面板上按。
- 卸载即无残留：只写工作区自己的 `.deed/`（诊断日志在 `.deed/tmp/dsh.log`，本来就不进仓库）。

## 装上

```powershell
# 1. 链接到 profile（不复制、不改 pnpm 锁）
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\deed-dsh" `
  -Target "<deed 仓库>\adapters\dsh"
# 2. profile 的加一层（cordis.patch.yml 末尾）
#  - insert:
#      - id: deed-dsh
#        name: deed-dsh
# 3. 重启 DSH 生效
```

拆掉：删掉那两行、删掉那个 Junction、重启。工作区里只会多出 `.deed/tmp/dsh.log`。

## 热重载

改完存盘就生效，不用重启——前提是 hmr 行监听了这个目录（默认 `root: []` 只监听配置，不监听源码）：

```yaml
- id: hmr
  config:
    root:
      - C:/Users/NUC/Desktop/deed/adapters/dsh
```

这条配置是**启动时**读的：先加它、重启一次；此后改 `index.js` 存盘即重载。重载会清掉内存里的
状态（`hands`、`askPoint`），所以审查者的映射写成子代理目录里的 `label`（就是 hand 名，
例如 `r-s01-1`），重载后按 `subagents.listChildren` 找回来，不会为同一份清单再起一个读者。

## 已知边界

- 适配器按顺序找 CLI：配置里的 `deed`（绝对路径）→ 工作区自带的 `cli/deed.mjs` → 适配器旁边那个（同一个仓库）→ PATH 上的 `deed`。用的是 `node`（PATH 或 `DEED_NODE`），不是 `process.execPath`——在宿主进程里那是宿主自己。
- 子代理的 API 名字随构建不同（本机是 `startContinuable`，另一些是 `startActivation`/`start`），适配器按能力挑。
- 惯例挂在 `turn/start` 而不是用户消息上：实测 `user/message` 落在第一个 `pre-step` 之后，挂在消息上会错过这一轮。
- 起子代理只能在父 agent 循环活着的时候（`turn/start`、`task.done`）；`turn/end` 起会报 `agent loop is not active`。
- 子代理继承父会话的工作目录与 AGENTS.md 指令链：审查者会看到工作区自己的规则。要干净的房间只能靠另一个 profile 或以后给子代理换 `cwd`（这一版没有这个口子）。
- headless 一次性运行会在父轮次结束时退出，来不及等审查者收工；要看完整效果在桌面端或 web 里跑。
