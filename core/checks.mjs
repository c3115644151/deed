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


// 范式的"格"：一类项目至少要有的角色。目录名可以不同——用 role 说清它是哪一格，
// 但格本身不能缺：缺一格，结构里就一定少了一类东西。
export const PARADIGM = {
  software: ["core", "app", "tests"],
  document: ["texts", "tests"],
  data: ["data", "schema", "tests"],
  work: ["tests"],
  free: [],
};

export const CHECKS = [
  {
    id: "workspace",
    title: "账本可读、审查设置已声明",
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
    title: "文件树符合范式",
    capability: "结构约束",
    fix: '把目录改成范式里的名字（core/ app/ tests/），或用 deed project 如实声明偏离，再看 deed check 指到哪',
    judge: ({ project, tree }) => {
      if (!project) return { verdict: "na", detail: "没有声明成项目" };
      if (project.shape === "free" || project.shape === "none")
        return { verdict: "na", detail: "这个项目声明不用结构：范式在这里不适用" };
      const layers = project.layers ?? [];
      if (layers.length === 0)
        return { verdict: "fail", detail: "声明成项目了，但没写分层：没有分层就没有可核的结构" };
      if (!tree) return { verdict: "na", detail: "这次没带目录快照" };

      // ① 范式要求的格必须在：缺一格，结构里就少了一类系统要读的东西。
      const roles = new Map(layers.map((one) => [one.role, one]));
      const absent = (PARADIGM[project.shape] ?? []).filter((role) => !roles.has(role));
      if (absent.length > 0)
        return { verdict: "fail", detail: "这一类项目缺这" + absent.length + "格：" + absent.join("、") };

      // ② 格的名字就是位置：范式规定的那几个格，目录必须同名。
      // 允许"改个名字再声明"就等于让检查形式化——偏离要看得见，不能自己消掉。
      const renamed = layers.filter((one) => one.role !== one.dir && (PARADIGM[project.shape] ?? []).includes(one.role));
      if (renamed.length > 0)
        return {
          verdict: "fail",
          detail: "范式里的格不能换目录名：" + renamed.map((one) => one.role + " 用了 " + one.dir).join("；"),
        };

      // ③ 声明的目录得在盘上（空目录不算：结构的意义是里面真放了东西）。
      const missing = layers.filter((one) => !tree.files.some((file) => file === one.dir || file.startsWith(one.dir + "/")));
      if (missing.length > 0)
        return { verdict: "fail", detail: "这些目录在盘上找不到：" + missing.map((one) => one.dir).join("、") };

      // ④ 盘上每个顶层目录都要有归属：认领成一格，或写进 extras 说清它不参与结构。
      const extras = new Set(project.extras ?? []);
      const tops = [...new Set(tree.files.map((file) => file.split("/")[0]))].filter((one) =>
        tree.files.some((file) => file.startsWith(one + "/")),
      );
      const roleNames = new Set(PARADIGM[project.shape] ?? []);
      const hiding = [...extras].filter((one) => roleNames.has(one));
      if (hiding.length > 0)
        return { verdict: "fail", detail: "这些目录本来就是范式里的格，不能当成 extras 藏起来：" + hiding.join("、") };
      const homeless = tops.filter((one) => !extras.has(one) && !layers.some((layer) => one === layer.dir || one.startsWith(layer.dir + "/")));
      if (homeless.length > 0)
        return { verdict: "fail", detail: "这些顶层目录没有归属：" + homeless.slice(0, 5).join("、") + "（认领成一格，或写进 extras）" };

      // ⑤ 跨格的依赖方向。
      const where = (file) => layers.find((one) => file === one.dir || file.startsWith(one.dir + "/")) ?? null;
      const broken = [];
      for (const edge of tree.imports) {
        const from = where(edge.from);
        const to = where(edge.to);
        if (!from || !to || from === to) continue;
        if (!from.mayImport.includes(to.role) && !from.mayImport.includes(to.dir))
          broken.push(from.dir + " → " + to.dir + "（" + edge.from + "）");
      }
      if (broken.length > 0)
        return { verdict: "fail", detail: "依赖方向反了：" + [...new Set(broken)].slice(0, 3).join("；") };

      // ⑥ 格里的东西要真成立：目前只有两份能被机械判——
      // 清单（系统每次 submit 都读它）与测试（tests 格里得有测试文件，不能只是个空壳）。
      if (!tree.plan) return { verdict: "fail", detail: "清单不成立：.deed/plan.md 没有或有空（deed plan 出草稿）" };
      const testsLayer = layers.find((one) => one.role === "tests");
      const hasTest = testsLayer && tree.files.some((file) => file.startsWith(testsLayer.dir + "/") && /\.(?:test|spec)\./u.test(file));
      if (!hasTest) return { verdict: "fail", detail: "tests 格里没有一个测试文件：这一格是空的" };

      return { verdict: "pass", detail: layers.length + " 个目录，名字与格都对上，方向都对" };
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
