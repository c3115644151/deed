// docs: the paste block in the README is the one the command prints.
//
// Two copies of the same prose drift the moment someone edits one of them, and
// the copy an agent pastes is the one that silently loses. The README quotes
// the printed text; this test is what keeps "quotes" true.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOCK } from "../cli/words.mjs";

const ROOT = path.join(import.meta.dirname, "..");

test("the README carries exactly the block init --print-agents prints", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("\`\`\`md\n" + BLOCK + "\n\`\`\`"), "README 里那段要和命令输出逐字相同（改了命令就重跑一次，把这段换掉）");
});

test("the block names the commands an agent needs, and no verb it does not have", () => {
  for (const verb of ["deed state", "deed tick", "deed task add", "deed task done", "deed review", "deed judge", "deed sign", "deed verify", "deed doctor"])
    assert.ok(BLOCK.includes(verb), "那段里少了 " + verb);
  assert.doesNotMatch(BLOCK, /deed (start|close|switch)\b/u, "没有的动作不要写进规则里");
});
