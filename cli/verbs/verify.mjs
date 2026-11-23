import path from "node:path";
import { digest } from "../../core/digest.mjs";
import { configDrift } from "../../core/rules.mjs";
import { readConfigFile } from "../../lib/store.mjs";
import { auditBriefs, auditEvidence, bareEvidence, bareHistory, briefTrouble } from "../audit.mjs";
import { stamp0 } from "../../lib/format.mjs";
import { ROOT, load, fail, guard } from "../session.mjs";

export default function verify() {
    guard(() => {
      const { doc } = load();
      if (!doc.config) {
        console.log("这个目录还没接 deed：deed init 之后才有账本和交付记录可查");
        process.exitCode = 1;
        return;
      }
      const { stale, outside, covered } = auditEvidence(ROOT, doc);
      if (covered.length > 0)
        console.log("早先的交付 " + covered.length + " 条 · 已被后来的交付覆盖（" + covered.map((one) => one.id).join("、") + "；钉过的内容现在是什么不再核对）");
      const bare = bareEvidence(doc);
      const past = bareHistory(doc);
      const briefs = auditBriefs(ROOT, doc);
      const looseBriefs = briefTrouble(briefs);
      for (const one of bare) console.log("没钉内容 · " + one.id + "（--evidence 里没有 --digest：说得出做了什么，查不了）");
      for (const one of briefs.unpinned) console.log("清单没指纹 · " + one.segment + " · " + one.brief + "（账本没记 sha256：改没改过查不出来）");
      for (const one of briefs.orphan)
        console.log("清单没人发过 · " + one.segment + " · " + one.brief + "（账本里没有 review.brief：这份结论读的是谁给的？）");
      for (const one of briefs.stray) console.log("清单没人认领 · " + one.brief + "（账本没记过这一份：手写的，或者出了没落成事件）");
      for (const one of briefs.gone) console.log("清单不在了 · " + one.segment + " · " + one.brief);
      for (const one of briefs.edited)
        console.log("清单对不上 · " + one.segment + " · " + one.brief + " · 账本记的 " + one.digest.slice(0, 12) + "，现在是 " + one.actual.slice(0, 12));
      for (const one of briefs.outside) console.log("清单越界 · " + one.segment + " · " + one.brief + "（不在这个工作区里）");
      // The threshold is a ledger fact; the file is a mirror. A mirror that
      // disagrees is not a broken ledger -- it is a decision nobody recorded.
      const drift = configDrift(doc.config, readConfigFile(ROOT));
      for (const one of drift)
        console.log("门槛对不上 · " + one.key + " · 账本里是 " + JSON.stringify(one.ledger) + "，磁盘上写的是 " + JSON.stringify(one.disk));
      const wrong = stale.length + outside.length;
      // 历史上写过、后来被重交盖住的空交付：不挡门，但账本里那句话确实存在过。
      for (const one of past)
        console.log(
          "空交付 · " +
            one.id +
            " · " +
            stamp0(one.at) +
            "（" +
            (one.withdrawn ? "撤回时没记下内容" : "那时没记下文件") +
            "：后来重交过，不挡放行）",
        );
      if (wrong === 0 && looseBriefs === 0 && drift.length === 0) {
        if (bare.length === 0) console.log("交付记录有效：每一条都说得出做了什么，也都记下了一份内容的 sha256");
        else console.log("交付记录有效：记下内容的都还在，另有 " + bare.length + " 条没记文件（要审的段判决前会被挡）");
        return;
      }
      for (const one of stale) console.log("交付记录过期 · " + one.id + " · " + one.path + " · 记下 " + one.digest.slice(0, 12));
      for (const one of outside) console.log("路径越界 · " + one.id + " · " + one.path + "（不在这个工作区里）");
      const reasons = [];
      if (wrong > 0)
        reasons.push(
          "有 " + wrong + " 处交付记录对不上" + (stale.length ? "：过期 " + stale.length : "") + (outside.length ? "：越界 " + outside.length : "") + "；重新交付，或者把它们从判决范围里去掉",
        );
      if (drift.length > 0)
        reasons.push(
          "门槛文件和账本对不上：规则只认账本，这一改没进过账本；要么用 deed init --force --why \"为什么改\" 把磁盘上的值收下，要么把文件改回账本里的值",
        );
      if (looseBriefs > 0)
        reasons.push(
          "有 " + looseBriefs + " 份清单对不上账本：结论读的那份被改过、丢了、没人发过，或者目录里躺着一份账本不认识的；审查者判不合格就点名退回（--verdict fail --rework T1 --why 「为什么」），再重新出一份、重新审一次——发清单本身会记成事件，指纹在那条事件上",
        );
      fail(reasons.join("；"));
    });
};
