import { ROOT, parse, guard } from "../session.mjs";
import { GROUPS, SPEC } from "../spec.mjs";
import { readTraces, byVerb } from "../trace.mjs";

// 观察层的读法：一次调用一行，这里只做归纳，不做判断动作。
// 三个问题，按"能据它改什么"排序：从没被敲过的、敲了就失败的、敲了没用的开关。
const fmt = (ms) => (ms === null || ms === undefined ? "—" : ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s");
const pct = (rate) => Math.round(rate * 100) + "%";

const groupOf = (verb) => GROUPS.find((one) => one.verbs.includes(verb))?.title ?? "";

// 一次都没被敲过的动词：不是"还没写"，是"写了没人用"——它背后的规则值得重新看一遍。
const neverCalled = (rows, groupFilter) => {
  const names = Object.keys(SPEC).filter((one) => one !== "debug" || true);
  const seen = new Set(rows.map((one) => one.verb));
  return names.filter((one) => !seen.has(one) && (!groupFilter || groupOf(one).includes(groupFilter)));
};

// 一次都没出现过的开关：还在帮助里教人用，却没人用过。
const deadSwitches = (rows) => {
  const used = new Set(rows.flatMap((one) => one.switches ?? []));
  const out = [];
  for (const [verb, spec] of Object.entries(SPEC)) {
    for (const flag of spec.flags ?? []) {
      if (used.has("--" + flag)) continue;
      // 说明挑写着这个开关的那一行；没有就退回第一行（有的开关只写在散文里）。
      const line = (spec.usage ?? []).find((one) => one.includes("--" + flag)) ?? "（只在帮助的散文里，没有单独一行）";
      out.push({ verb, flag: "--" + flag, usage: line.replace(/\s+/gu, " ").trim().slice(0, 72) });
    }
  }
  return out;
};

export default function debug(argv) {
  const { flags } = parse(argv, "debug");
  guard(() => {
    const days = Number(flags.days ?? 30);
    const rows = readTraces(ROOT, Number.isFinite(days) && days > 0 ? days : 30);
    const verbs = byVerb(rows);
    // 这一次自己还没落行（要读完才写）：别把自己列进"从没敲过"。
    const never = neverCalled(rows).filter((one) => one !== "debug");
    const dead = deadSwitches(rows);
    const whys = new Map();
    for (const one of verbs) for (const w of one.whys) whys.set(w.why, (whys.get(w.why) ?? 0) + w.n);
    const refusals = [...whys.entries()].sort((a, b) => b[1] - a[1]);

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            window: { days },
            calls: rows.length,
            enough: rows.length >= 50,
            verbs: verbs.map((one) => ({
              verb: one.verb,
              calls: one.calls,
              ok: one.ok,
              fail: one.fail,
              rate: Number(one.rate.toFixed(3)),
              p50: one.p50,
              p95: one.p95,
              last: one.last,
              switches: one.switches.map((s) => s.name),
              whys: one.whys,
            })),
            never,
            deadSwitches: dead,
            refusals: refusals.map(([why, n]) => ({ why, n })),
          },
          null,
          1,
        ),
      );
      return;
    }

    console.log("调试 · 最近 " + (Number.isFinite(days) ? days : 30) + " 天 · " + rows.length + " 次调用");
    if (rows.length < 50)
      console.log("  样本还少（不到 50 次）：下面那节「从没敲过」只当提示，别当结论——先攒够再改。");

    console.log("");
    console.log("从没敲过（它背后的规则值得重新看一遍）");
    if (never.length === 0) console.log("  没有：每个动词至少被用了一次。");
    for (const verb of never) console.log("  · " + verb.padEnd(9) + " " + groupOf(verb) + " · " + (SPEC[verb].usage[0] ?? "").split("  ")[0]);

    console.log("");
    console.log("敲了就失败最多的");
    const failing = verbs.filter((one) => one.fail > 0).sort((a, b) => b.rate - a.rate || b.fail - a.fail);
    if (failing.length === 0) console.log("  没有：窗口里没有一次被拒。");
    for (const one of failing.slice(0, 6))
      console.log(
        "  " + one.verb.padEnd(9) + " " + String(one.calls).padStart(4) + " 次 · 失败 " + String(one.fail).padStart(3) +
          " · " + pct(one.rate).padStart(4) + (one.whys[0] ? "  最多的一句：" + one.whys[0].why.slice(0, 46) : ""),
      );

    console.log("");
    console.log("一次都没用过的开关（还在教人用，却没人用）");
    if (dead.length === 0) console.log("  没有：帮助里每个开关都被用过。");
    for (const one of dead.slice(0, 10)) console.log("  " + (one.verb + " " + one.flag).padEnd(22) + one.usage);

    if (refusals.length > 0) {
      console.log("");
      console.log("拒绝的话（按次数排：说得最多的一句，就是最贵的那处设计）");
      for (const [why, n] of refusals.slice(0, 6)) console.log("  " + String(n).padStart(4) + " 次 · " + why.slice(0, 90));
    }

    const slow = verbs.filter((one) => one.p95 !== null).sort((a, b) => b.p95 - a.p95).slice(0, 3);
    if (slow.length > 0 && slow[0].p95 > 200) {
      console.log("");
      console.log("最慢的三个（p95）");
      for (const one of slow) console.log("  " + one.verb.padEnd(9) + " p50 " + fmt(one.p50) + " · p95 " + fmt(one.p95));
    }
  });
}
