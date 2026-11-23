# 这份示例是什么

一个照着 `deed` 规则长出来的工作区：账本在 `.deed/log/`，审查清单与角色包在 `.deed/review/`——
发清单这件事本身记在账本里（`review.brief` + 两份 sha256），结论只回答发出去的那两份。
门槛也在账本里（`.deed/config.json` 只是它的镜像；规则读的是 `config.change` 重放出来的那份）。
它演示五件事：一段被审查者放行后封存、一次判不合格点名退回后的重交与重审、清单发出与被回答的两步、
一条被延后的任务、一条还没裁的问题。

## 怎么重放

```
node examples/rebuild.mjs      # 从空账本重跑一遍，覆盖这里的 .deed/
```

脚本只调用 `cli/deed.mjs` 的真实命令，没有一个事件是手写的；时间戳与清单哈希随运行变化，
事件的种类与顺序不变。

## 怎么读

```
cd examples/contract
node ../../cli/deed.mjs state
node ../../cli/deed.mjs verify
node ../../cli/deed.mjs serve --port 7419
```

面板不写账本：它渲染的就是 `state` 读到的同一份事实。
