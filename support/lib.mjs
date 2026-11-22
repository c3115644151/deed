import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// TEMP is not always where a test runner thinks it is (in this harness os.tmpdir()
// can come back as "undefined\\temp"), so fall back to a directory inside the repo
// rather than silently creating a fake path in the project root.
const base0 = os.tmpdir();
const BASE =
  path.isAbsolute(base0) && !base0.startsWith("undefined")
    ? base0
    : path.join(import.meta.dirname, "..", ".deed-test");

export function workspace(name) {
  const base = path.join(BASE, "deed-test-" + name + "-" + process.pid + "-" + Date.now());
  fs.mkdirSync(base, { recursive: true });
  return base;
}
