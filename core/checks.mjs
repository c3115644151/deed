// checks: 体检层。它读事实（账本重放的结果 + 盘上的目录快照），不产生事实；
// 它给出状态与诊断，不产生行动。行动仍由 core/rules.mjs 给。
//
// 这张表同时是"机制登记处"：一个新机制要成为系统的一部分，就在这里登记一行，
// 写清它依赖哪些事实、怎么判、不过时怎么修、通过之后解锁什么。没登记的机制
// 不算系统的一部分。
//
// 判定的三种结论：
//   pass —— 通过
//   fail —— 未通过（缺什么写在 detail 里，fix 是给人跑的那一步）
//   na   —— 不适用（这个工作区没声明成项目时，项目级的检查都不适用）
// 不适用不算未结项：状态只在"已声明的项目"上计算通过率。

export const CHECKS = [
  {
    id: "workspace",
    title: "工作区能记账、能重放",
    capability: "三种状态与账本",
    fix: 'deed init --said "这一轮说了什么"',
    judge: ({ doc }) => {
      if (!doc || !Array.isArray(doc.sessions))
        return { verdict: "fail", detail: "账本读不出会话：这个目录还没接过 deed" };
      if (doc.config === null || doc.config === undefined)
        return { verdict: "fail", detail: "账本里没有审查设置：init 还没跑过" };
      return { verdict: "pass", detail: doc.sessions.length + " 期" };
    },
  },
  {
    id: "shape",
    title: "文件树符合声明的分层",
    capability: "结构约束",
    fix: 'deed project --layers "core:,lib:core" --by 谁（按实际的目录与依赖方向写）',
    judge: ({ project, tree }) => {
      if (!project) return { verdict: "na", detail: "没有声明成项目" };
      if (project.shape === "free" || project.shape === "none")
        return { verdict: "pass", detail: "这个项目声明不用结构约束" };
      if ((project.layers ?? []).length === 0)
        return { verdict: "fail", detail: "声明成项目了，但没写分层：没有分层就没有可核的结构" };
      if (!tree) return { verdict: "na", detail: "这次没带目录快照" };
      const missing = project.layers.filter((one) => !tree.files.some((file) => file === one.dir || file.startsWith(one.dir + "/")));
      if (missing.length > 0)
        return { verdict: "fail", detail: "这些层在盘上找不到：" + missing.map((one) => one.dir).join("、") };
      const where = (file) => project.layers.find((one) => file === one.dir || file.startsWith(one.dir + "/")) ?? null;
      const broken = [];
      for (const edge of tree.imports) {
        const from = where(edge.from);
        const to = where(edge.to);
        if (!from || !to || from === to) continue;
        if (!from.mayImport.includes(to.dir)) broken.push(from.dir + " → " + to.dir + "（" + edge.from + "）");
      }
      if (broken.length > 0)
        return { verdict: "fail", detail: "依赖方向反了：" + [...new Set(broken)].slice(0, 3).join("；") };
      return { verdict: "pass", detail: project.layers.length + " 层，方向都对" };
    },
  },
  {
    id: "background",
    title: "项目背景已写",
    capability: "项目级验收",
    fix: 'deed project --background "这个项目是什么、为谁、不做什么" --by 谁',
    judge: ({ project }) => {
      if (!project) return { verdict: "na", detail: "没有声明成项目" };
      const text = String(project.background ?? "").trim();
      if (text === "") return { verdict: "fail", detail: "背景是空的：签收与期审没有尺子可用" };
      return { verdict: "pass", detail: text.length + " 字" };
    },
  },
];

export const projectOf = (doc) => doc?.project ?? null;

// 状态是算出来的，不是记下来的：没声明就没有状态可言；声明了才谈通过率。
export function checkAll(doc, tree = null) {
  const project = projectOf(doc);
  const facts = { doc, project, tree };
  return CHECKS.map((check) => ({ id: check.id, title: check.title, capability: check.capability, fix: check.fix, ...check.judge(facts) }));
}

export function projectState(doc, tree = null) {
  const project = projectOf(doc);
  const list = checkAll(doc, tree);
  if (!project) return { declared: false, shape: null, passed: 0, total: list.length, missing: [], checks: list };
  const ok = list.filter((one) => one.verdict === "pass" || one.verdict === "na");
  return {
    declared: true,
    shape: project.shape,
    passed: ok.length,
    total: list.length,
    missing: list.filter((one) => one.verdict === "fail").map((one) => one.title),
    checks: list,
  };
}
