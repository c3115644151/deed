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
  // 清单是系统每次 submit 都读的那份文件：它在不在、有没有内容，是盘上的事实。
  let plan = false;
  try {
    plan = fs.readFileSync(path.join(root, ".deed", "plan.md"), "utf8").trim().length > 0;
  } catch {
    plan = false;
  }
  return { files, imports, plan };
}
