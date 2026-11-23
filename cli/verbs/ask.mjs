import { reading } from "../../core/rules.mjs";
import { parse, transact, session, nextId, fail, guard, signer } from "../session.mjs";

export default function ask(argv) {
    const [verb, ...rest] = argv;
    const { flags, words } = parse(rest, "ask");
    const id = words[0] ?? flags.id;
    guard(() => {
      if (verb === "resolve" || verb === "withdraw") {
        if (!id) fail("ask " + verb + " 要点名待裁项");
        if (verb === "resolve" && !flags.decision) fail("ask resolve 要写清裁定：--decision \"…\"");
        if (verb === "withdraw" && !flags.why) fail("ask withdraw 要说清为什么撤回：--why \"…\"");
        transact(flags, () => ({
          k: verb === "resolve" ? "ask.resolve" : "ask.withdraw",
          s: flags.session ?? null,
          id,
          decision: flags.decision,
          why: flags.why,
          by: signer(flags, verb === "resolve" ? "裁定" : "撤回待裁"),
        }));
        console.log((verb === "resolve" ? "裁定" : "撤回") + " · " + id + " · " + (flags.decision ?? flags.why));
        return;
      }
      const text = verb && verb !== "raise" ? [verb, ...words].join(" ") : words.join(" ");
      if (!text) fail("ask 要写清问题：deed ask \"…\" --reading \"…\" --why \"…\"");
      if (!flags.reading) fail("ask 必须写清我理解成什么：--reading \"…\"");
      if (!flags.why) fail("ask 必须写清为什么不确定：--why \"…\"");
      const { ev } = transact(flags, (doc0) => ({
        k: "ask.raise",
        s: flags.session ?? null,
        id: flags.id ?? nextId(doc0, "A"),
        text,
        reading: flags.reading,
        why: flags.why,
      }));
      console.log("待裁 · " + ev.id + " · " + text);
    });
};
