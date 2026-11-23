import { createHash } from "node:crypto";

// 一处算指纹：交付记录、审查清单、工作区快照都用它。
// 换算法只改这里——规则、事件、面板都不用跟着改。
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
