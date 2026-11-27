import { ROOT, parse, guard } from "../session.mjs";
import { GROUPS, SPEC } from "../spec.mjs";
import { readTraces, byVerb } from "../trace.mjs";

// 观察层只印量。这里的每一行都要能被人拿着工具复核：
// 窗口多少天、多少次调用、每条命令几次、退出码分布、耗时、哪些开关在窗口内没出现、
// 程序打出的那些话各出现几次。这里不解释这些量，也不替读的人下判断。

const ms = (one) => (one === null || one === undefined ? null : one);
const round = (one) => (one === null ? "—" : String(one));
const secs = (one) => (one === null ? "—" : one < 1000 ? one + "ms" : (one / 1000).toFixed(1) + "s");

const groupOf = (verb) => GROUPS.find((one) => one.verbs.includes(verb))?.title ?? "";

// SPEC 里有、窗口内一次都没出现过。这是量出来的，不是想出来的。
const absentVerbs = (rows) => {
  const seen = new Set(rows.map((one) => one.verb));
  return Object.keys(SPEC).filter((one) => !seen.has(one) && one !== "debug");
};

const absentSwitches = (rows) => {
  const used = new Set(rows.flatMap((one) => one.switches ?? []));
  const out = [];
  for (const [verb, spec] of Object.entries(SPEC))
    for (const flag of spec.flags ?? []) if (!used.has("--" + flag)) out.push({ verb, flag: "--" + flag });
  return out;
};

export default function debug(argv) {
  const { flags } = parse(argv, "debug");
  guard(() => {
    const days = Number(flags.days ?? 30);
    const window = Number.isFinite(days) && days > 0 ? days : 30;
    const rows = readTraces(ROOT, window);
    const verbs = byVerb(rows);
    const absent = absentVerbs(rows);
    const switches = absentSwitches(rows);
    const whys = new Map();
    for (const one of verbs) for (const w of one.whys) whys.set(w.why, (whys.get(w.why) ?? 0) + w.n);
    const refusals = [...whys.entries()].sort((a, b) => b[1] - a[1]);
    const first = rows[0]?.at ?? null;
    const last = rows[rows.length - 1]?.at ?? null;

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            window: { days: window, from: first, to: last, calls: rows.length },
            verbs: verbs.map((one) => ({
              verb: one.verb,
              group: groupOf(one.verb),
              calls: one.calls,
              codes: one.codes,
              rate: one.calls === 0 ? 0 : Number((one.fail / one.calls).toFixed(3)),
              p50: one.p50,
              p95: one.p95,
              last: one.last,
              switches: one.switches.map((s) => s.name),
              whys: one.whys,
            })),
            absentVerbs: absent,
            absentSwitches: switches,
            refusals: refusals.map(([why, n]) => ({ why, n })),
          },
          null,
          1,
        ),
      );
      return;
    }

    console.log("观察 · 最近 " + window + " 天 · " + rows.length + " 次调用 · " + (first ?? "—") + " 起");
    console.log("");
    console.log("动词 · 调用 · 退出码 · 耗时 · 用过的开关 · 最近一次");
    if (verbs.length === 0) console.log("  （窗口里没有调用）");
    for (const one of verbs) {
      const codes = one.codes.map((c) => (c.code === null ? "?" : c.code) + "×" + c.n).join(" ");
      console.log(
        "  " + one.verb.padEnd(9) + " " + String(one.calls).padStart(4) + "  " + (codes || "—").padEnd(10) +
          " p50 " + secs(ms(one.p50)).padStart(7) + " p95 " + secs(ms(one.p95)).padStart(7) + "  " +
          (one.switches.map((s) => s.name + "×" + s.n).join(" ") || "—"),
      );
    }

    console.log("");
    console.log("窗口内一次都没出现过的动词（" + absent.length + " 个）");
    for (const verb of absent) console.log("  " + verb.padEnd(9) + groupOf(verb));
    if (absent.length === 0) console.log("  （没有）");

    console.log("");
    console.log("窗口内一次都没出现过的开关（" + switches.length + " 个）");
    for (const one of switches) console.log("  " + (one.verb + " " + one.flag).padEnd(22));
    if (switches.length === 0) console.log("  （没有）");

    if (refusals.length > 0) {
      console.log("");
      console.log("程序自己打出的那句话（非零退出时），按出现的次数");
      for (const [why, n] of refusals) console.log("  " + String(n).padStart(4) + " × " + why);
    }
  });
}
