// tree: 盘上的事实，交给检查层"看"，而不是让检查层自己去读盘。
// 检查层因此是纯的：同样的账本 + 同样的目录快照，永远得到同样的结论。
import fs from "node:fs";
import path from "node:path";

// 这些目录里的东西不是"项目结构"的一部分：账本、过程材料、依赖、版本库。
const SKIP = new Set(["node_modules", ".git", ".deed", ".deed-test", ".tmp", ".shots", ".work", ".archify", ".idea", ".vscode", "dist", "build"]);

const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;

function walk(root, at, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(at, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).replace(/\\/gu, "/"));
  }
}

// 一个文件"在管几件事"的近似：决策分支的个数。行数会被注释和长表达式污染，
// 分支数不会——它是 R1 的硬指标（见 docs/PLAN-ARCH.md）。
const BRANCH = /\b(?:if|else\s+if)\s*\(|\bcase\s+["'`]|\?\s*[^?:\n]{1,40}:/gu;

// 只解析相对 import：外部包不在"这个项目的分层"里，它们的依赖方向不归这条检查管。
export function treeOf(root) {
  const files = [];
  walk(root, root, files);
  files.sort();
  const imports = [];
  for (const file of files) {
    if (!/\.(?:mjs|js|cjs|ts|tsx)$/u.test(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const hit of text.matchAll(IMPORT)) {
      const spec = hit[1];
      if (!spec.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      imports.push({ from: file, to: target.replace(/^\.\//u, "") });
    }
  }
  // 每个源文件的行数与分支数：检查层拿它判上限，不自己读盘。
  const stats = [];
  for (const file of files) {
    if (!/\.(?:mjs|js|cjs|ts|tsx)$/u.test(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    stats.push({ file, lines: text.split("\n").length, branches: (text.match(BRANCH) ?? []).length });
  }
  // 地图：docs/STRUCTURE.md 里被反引号括起来的路径，是「这份代码由哪些文件组成」的唯一名单。
  let map = null;
  try {
    const text = fs.readFileSync(path.join(root, "docs", "STRUCTURE.md"), "utf8");
    map = [...text.matchAll(/`((?:core|cli|board|lib|adapters)\/[^`]+\.mjs)`/gu)].map((hit) => hit[1]);
  } catch {
    map = null;
  }
  // 这个工作区是不是 deed 自己：系统结构那三条只对它成立，对用户项目不成立。
  let self = false;
  try {
    self = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name === "deed";
  } catch {
    self = false;
  }
  // 事件定义与处理处：检查层拿它对账，不自己读源码。
  const kindsOf = (text, pattern) => [...text.matchAll(pattern)].map((hit) => hit[1]);
  const readOne = (file) => {
    try {
      return fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  const eventKinds = [];
  for (const file of files) {
    if (!file.startsWith("core/events/")) continue;
    if (file.endsWith("/index.mjs") || file.endsWith("/shape.mjs")) continue;
    const hit = /export const KINDS = (\[[^\]]*\])/u.exec(readOne(file));
    if (hit) eventKinds.push(...JSON.parse(hit[1]));
  }
  // 过渡期里 fold 还可能留着分支；移完之后这里永远是空的。
  const foldCases = [...readOne("core/fold.mjs").matchAll(/case "([\w.]+)"|\n/gmu)].filter((hit) => hit[1]).map((hit) => hit[1]);
  // 处理处：注册表里的 kind。
  const reducerKinds = [];
  for (const file of files) {
    if (!file.startsWith("core/replay/reducers/")) continue;
    for (const hit of readOne(file).matchAll(/^ {2}"([\w.]+)":/gmu)) reducerKinds.push(hit[1]);
  }
  // 清单是系统每次 submit 都读的那份文件：它在不在、有没有内容，是盘上的事实。
  let plan = false;
  try {
    plan = fs.readFileSync(path.join(root, ".deed", "plan.md"), "utf8").trim().length > 0;
  } catch {
    plan = false;
  }
  return { files, imports, plan, stats, eventKinds, foldCases, reducerKinds, self, map };
}
