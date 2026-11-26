import { reading } from "../../core/rules.mjs";
import { parse, transact, session, nextId, fail, guard, signer } from "../session.mjs";

export default function ask(argv) {
    const [verb, ...rest] = argv;
    const { flags, words } = parse(rest, "ask");
    const id = words[0] ?? flags.id;
    guard(() => {
      // 旧名不再收：两个名字通向同一件事，读账本的人就分不清哪条是真入口。
      if (verb === "resolve" || verb === "withdraw")
        fail("ask " + verb + " 已经改成 ask " + (verb === "resolve" ? "answer" : "drop") + " " + (id ?? "A1"));
      if (verb === "answer" || verb === "drop") {
        if (!id) fail("ask " + verb + " 要点名待裁项");
        if (verb === "answer" && !flags.decision) fail('ask answer 要写清裁定：--decision "…"');
        if (verb === "drop" && !flags.why) fail('ask drop 要说清为什么撤回：--why "…"');
        const cut = verb === "answer" ? (flags.decision.match(/^(边界|弃)\s*[:：]\s*.*$/gmu) ?? []) : [];
        for (const one of cut)
          if (!/[:：]\s*\S/u.test(one)) fail("裁定里的「" + one.trim() + "」没写内容：边界要写清不许做什么，弃要写清哪件事不做了");
        transact(flags, () => ({
          k: verb === "answer" ? "ask.resolve" : "ask.withdraw",
          s: flags.session ?? null,
          id,
          decision: flags.decision,
          why: flags.why,
          by: signer(flags, verb === "answer" ? "裁定" : "撤回待裁"),
        }));
        console.log((verb === "answer" ? "裁定" : "撤回") + " · " + id + " · " + (flags.decision ?? flags.why));
        if (cut.length) console.log("  记下 · " + cut.length + " 条（边界与弃跟着这句话留在这期的账里，不进清单）");
        return;
      }
      const text = verb && verb !== "raise" ? [verb, ...words].join(" ") : words.join(" ");
      if (!text) fail('ask 要写清问题：deed ask "…" --reading "我理解成…"');
      if (!flags.reading) fail('ask 必须写清我理解成什么：--reading "…"');
      const { ev } = transact(flags, (doc0) => ({
        k: "ask.raise",
        s: flags.session ?? null,
        id: flags.id ?? nextId(doc0, "A"),
        text,
        reading: flags.reading,
      }));
      console.log("待裁 · " + ev.id + " · " + text);
    });
};
