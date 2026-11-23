import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { paths, rel } from "../lib/store.mjs";

// 核对"账本说的"与"工作区现在的"：这是唯一一条从账本往磁盘看的通道。
// 工作区当参数传进来，模块自己不认 cwd——同一段判断在哪跑都读同一份。

// 一条交付里记下的 sha256 是"当时那份字节"的一句话。它什么时候失效？
// 两种：工作区里那条路径现在不是那些字节，而且后来也没人重钉过它；或者路径跑出了工作区。
// 后来的交付重钉了同一条路径，最后那句话才代表现在的字节——旧的那句是被覆盖，不是过期：
// 它该不该存在由钉它的那条回答，不归更早的那条追问。
// 少了这一条，文档被后来的任务改一次，所有盯过它的记录都会变成过期，逼着人重交一遍同一份东西、写一句不实的话。
const filesOf = (proof) =>
  proof.files ?? (proof.digest && proof.path ? [{ path: proof.path, digest: proof.digest }] : []);

export function auditEvidence(root, doc, sessionId) {
  const pins = [];
  for (const one of doc.sessions)
    for (const task of one.tasks)
      for (const proof of task.evidence)
        for (const file of filesOf(proof)) pins.push({ at: proof.at, path: file.path, digest: file.digest });

  const stale = [];
  const outside = [];
  const covered = [];
  for (const one of doc.sessions) {
    if (sessionId && one.id !== sessionId) continue;
    for (const task of one.tasks) {
      const claim = task.evidence[task.evidence.length - 1];
      for (const proof of task.evidence) {
        for (const file of filesOf(proof)) {
          if (proof !== claim) {
            covered.push({ id: task.id, path: file.path, digest: file.digest });
            continue;
          }
          const abs = path.resolve(root, file.path);
          const inside = path.relative(root, abs);
          if (inside.startsWith("..") || path.isAbsolute(inside)) {
            outside.push({ id: task.id, path: file.path });
            continue;
          }
          const actual = fs.existsSync(abs) ? digest(fs.readFileSync(abs)) : null;
          if (actual === file.digest) continue;
          // Whoever pinned this path last owns today's bytes. Whether they were
          // right is their claim to answer, not the earlier one's.
          const later = pins.some((pin) => pin.path === file.path && pin.at > proof.at);
          if (later) covered.push({ id: task.id, path: file.path, digest: file.digest });
          else stale.push({ id: task.id, path: file.path, digest: file.digest });
        }
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
      if (claim && filesOf(claim).length === 0) bare.push({ id: task.id });
    }
  return bare;
}

// The brief is outside the ledger, so the ledger keeps its path and sha256.
// Five ways that pair stops meaning anything: the document was edited after it
// was handed out, it was removed, it was never handed out at all (a verdict
// naming a document with no review.brief behind it), a file in the review
// folder that no event mentions, or a legacy line that recorded no digest.
// Each one leaves a conclusion that points at bytes nobody can vouch for.
// 一份材料属于一段还是一期：整期审的材料没有段这一格，报告里就写"整期"，
// 别让一条结论的位置显示成 null。
const whereOf = (one) => one?.segment ?? (one?.scope === "session" ? "整期" : null);

export function auditBriefs(root, doc, sessionId) {
  const edited = [];
  const gone = [];
  const orphan = [];
  const unpinned = [];
  const outside = [];
  const claimed = new Set();
  for (const one of doc.sessions) {
    if (sessionId && one.id !== sessionId) continue;
    // 交出去的是两份：清单（审什么）和角色包（怎么审）。两份都记了指纹，
    // 所以两份都要核——只核清单，换掉角色包没人看得出来。
    for (const hand of one.briefs) {
      const pair = [
        { brief: hand.brief, digest: hand.briefDigest },
        ...(hand.guide ? [{ brief: hand.guide, digest: hand.guideDigest }] : []),
      ];
      for (const one2 of pair) {
        claimed.add(one2.brief);
        const file = path.resolve(root, one2.brief);
        const inside = path.relative(root, file);
        if (inside.startsWith("..") || path.isAbsolute(inside)) {
          outside.push({ segment: whereOf(hand), brief: one2.brief });
          continue;
        }
        if (!one2.digest) {
          unpinned.push({ segment: whereOf(hand), brief: one2.brief });
          continue;
        }
        if (!fs.existsSync(file)) {
          gone.push({ segment: whereOf(hand), brief: one2.brief });
          continue;
        }
        const actual = digest(fs.readFileSync(file));
        if (actual !== one2.digest) edited.push({ segment: whereOf(hand), brief: one2.brief, digest: one2.digest, actual });
      }
    }
    for (const review of one.reviews) {
      claimed.add(review.brief);
      const handed = one.briefs.some((hand) => hand.brief === review.brief && hand.briefDigest === review.briefDigest);
      if (!handed && review.briefDigest) orphan.push({ segment: whereOf(review), brief: review.brief });
      if (!review.briefDigest) unpinned.push({ segment: whereOf(review), brief: review.brief });
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

