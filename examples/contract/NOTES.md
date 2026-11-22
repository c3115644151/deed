# 这份示例是什么

一个照着 `deed` 规则长出来的工作区：账本在 `.deed/log/`，任务书在 `.deed/review/`，
门槛在账本里（`.deed/config.json` 只是它的镜像；判据读的是 `config.change` 折出来的那份）。它演示四件事：一段被审过再判、一次判不过的打回与重审、
一条被延后的任务、一条还没裁的问题。

## 怎么重放

```
node examples/rebuild.mjs      # 从空账本重跑一遍，覆盖这里的 .deed/
```

脚本只调用 `cli/deed.mjs` 的真实命令，没有一个事件是手写的；时间戳与任务书哈希随运行变化，
事件的种类与顺序不变。

## 怎么读

```
cd examples/contract
node ../../cli/deed.mjs state
node ../../cli/deed.mjs verify
node ../../cli/deed.mjs serve --port 7419
```

面板不写账本：它渲染的就是 `state` 读到的同一份事实。
