import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspace } from "../support/lib.mjs";
import { hookNotice, silenceNotice } from "../cli/heartbeat.mjs";

// Stamps read like the CLI's, so the message under a test is the message a
// person sees.
const stamp = (iso) => new Date(iso).toISOString().slice(5, 16).replace("T", " ");

test("a hook that runs deed tick is a fact about the host, not a guess", () => {
  const cwd = workspace("hook");
  assert.match(hookNotice(cwd), /未接/, "没有配置就是未接，不猜");
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ command: "deed tick --who agent --said hi" }] } }));
  assert.match(hookNotice(cwd), /已接（\.claude\/settings\.json/);
  // The config is read as text, not parsed: whatever shape a host invents, a
  // file that runs the command is what "接上了" means.
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ note: "deed tick 是每轮的心跳" }));
  assert.match(hookNotice(cwd), /已接/);
});

test("silence is measured, never judged", () => {
  const at = "2026-11-23T05:00:00.000Z";
  const now = new Date("2026-11-23T05:32:00.000Z");
  assert.equal(silenceNotice(at, stamp, now), "账本最后一条 11-23 05:00（32 分钟前）");
  assert.equal(silenceNotice(at, stamp, new Date("2026-11-23T08:10:00.000Z")), "账本最后一条 11-23 05:00（3 小时前）");
  assert.match(silenceNotice(at, stamp, new Date("2026-11-23T05:00:30.000Z")), /（刚刚）/);
  assert.equal(silenceNotice(null, stamp, now), null, "空账本没有时长可说");
  assert.equal(silenceNotice("not-a-date", stamp, now), null);
});
