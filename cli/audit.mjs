import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { paths, rel } from "../lib/store.mjs";

// 核对"账本说的"与"工作区现在的"：这是唯一一条从账本往磁盘看的通道。
// 工作区当参数传进来，模块自己不认 cwd——同一段判断在哪跑都读同一份。

// 一条任务只有一份现行交付：它最后说的那句话。更早的交付是账本历史（谁在哪天说过什么），
// 不是这一版交付——它们记下的内容当然会跟着工作区变，那不是错，只是过去了。
// 所以三条判断只对现行那份做：内容变了（过期）、路径出了工作区、什么都没钉（没得查）。
// 早先那些钉过的交付单独列出来，报个条数，不算坏账、不挡判决。
export function auditEvidence(root, doc, sessionId) {
  const stale = [];
  const outside = [];
  const covered = [];
  for (const one of doc.sessions) {
    if (sessionId && one.id !== sessionId) continue;
    for (const task of one.tasks) {
      const claim = task.evidence[task.evidence.length - 1];
      for (const proof of task.evidence) {
        if (!proof.digest || !proof.path) continue;
        const file = path.resolve(root, proof.path);
        if (proof !== claim) {
          covered.push({ id: task.id, path: proof.path, digest: proof.digest });
          continue;
        }
        const inside = path.relative(root, file);
        if (inside.startsWith("..") || path.isAbsolute(inside)) {
          outside.push({ id: task.id, path: proof.path });
          continue;
        }
        const actual = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
        if (actual !== proof.digest) stale.push({ id: task.id, path: proof.path, digest: proof.digest });
      }
    }
  }
  return { stale, outside, covered };
}

export const staleEvidence = (root, doc, sessionId) => auditEvidence(root, doc, sessionId).stale;

export function bareEvidence(doc) {
  const bare = [];
  for (const one of doc.sessions)
    for (const task of one.tasks) {
      const claim = task.evidence[task.evidence.length - 1];
      if (claim && !(claim.digest && claim.path)) bare.push({ id: task.id });
    }
  return bare;
}

// The brief is outside the ledger, so the ledger keeps its path and sha256.
// Five ways that pair stops meaning anything: the document was edited after it
// was handed out, it was removed, it was never handed out at all (a verdict
// naming a document with no review.brief behind it), a file in the review
// folder that no event mentions, or a legacy line that recorded no digest.
// Each one leaves a conclusion that points at bytes nobody can vouch for.
export function auditBriefs(root, doc, sessionId) {
  const edited = [];
  const gone = [];
  const orphan = [];
  const unpinned = [];
  const outside = [];
  const claimed = new Set();
  for (const one of doc.sessions) {
    if (sessionId && one.id !== sessionId) continue;
    for (const hand of one.briefs) {
      claimed.add(hand.brief);
      const file = path.resolve(root, hand.brief);
      const inside = path.relative(root, file);
      if (inside.startsWith("..") || path.isAbsolute(inside)) {
        outside.push({ segment: hand.segment, brief: hand.brief });
        continue;
      }
      if (!hand.briefDigest) {
        unpinned.push({ segment: hand.segment, brief: hand.brief });
        continue;
      }
      if (!fs.existsSync(file)) {
        gone.push({ segment: hand.segment, brief: hand.brief });
        continue;
      }
      const actual = digest(fs.readFileSync(file));
      if (actual !== hand.briefDigest) edited.push({ segment: hand.segment, brief: hand.brief, digest: hand.briefDigest, actual });
    }
    for (const review of one.reviews) {
      claimed.add(review.brief);
      const handed = one.briefs.some((hand) => hand.brief === review.brief && hand.briefDigest === review.briefDigest);
      if (!handed && review.briefDigest) orphan.push({ segment: review.segment, brief: review.brief });
      if (!review.briefDigest) unpinned.push({ segment: review.segment, brief: review.brief });
    }
  }
  // Files left in the review folder that no line points at: a hand-written
  // brief, or one written before handing out became a fact.
  const stray = [];
  const dir = paths(root).review;
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".md")) continue;
      const brief = rel(root, path.join(dir, name));
      if (!claimed.has(brief)) stray.push({ brief });
    }
  }
  return { edited, gone, orphan, unpinned, outside, stray };
}

export const briefTrouble = (audit) =>
  audit.edited.length + audit.gone.length + audit.orphan.length + audit.unpinned.length + audit.outside.length + audit.stray.length;

