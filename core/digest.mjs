import { createHash } from "node:crypto";

// 一处算指纹：证据、任务书、工作区快照都用它。
// 换算法只改这里——判据、事件、面板都不用跟着改。
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
