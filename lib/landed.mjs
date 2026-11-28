import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// 记账那一刻称下的字节就是这条记录指着的那份内容。读账本的人回不到那一刻，
// 所以这次核对要当场做：现在盘上还是不是它、是不是空壳、还在不在。
// 返回的是对不上的那些（一句一条），空数组就是都对得上。
export function checkLanded(root, events) {
  const problems = [];
  for (const ev of events) {
    if (ev.k !== "task.done") continue;
    const paths = (ev.files ?? []).map((one) => one.path);
    if (paths.length === 0) continue; // 靠 期望 自证的交付没有文件可指，不算错
    for (const one of paths) {
      const full = path.join(root, one);
      const was = (ev.bytes ?? {})[one];
      if (!fs.existsSync(full)) {
        // 记下时它就不在（这一条交付说的正是"删掉了"）：那不是对不上。
        // 记下过字节、现在却没了，才是被人在记账之后动过。
        if (typeof was === "number") problems.push(one + " 已经不在盘上（记下过 " + was + " 字节）");
        continue;
      }
      const size = fs.statSync(full).size;
      if (size === 0) {
        problems.push(one + " 是 0 字节");
        continue;
      }
      if (typeof was === "number" && size !== was) {
        problems.push(one + " 盘上已经换成另一份：记下 " + was + " 字节，现在 " + size + " 字节");
        continue;
      }
      // 同尺寸换内容：字节数看不出来，指纹看得出来。
      const wasSha = (ev.sha ?? {})[one];
      if (typeof wasSha === "string") {
        const now = createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 16);
        if (now !== wasSha)
          problems.push(one + " 盘上已经换成另一份：尺寸一样，内容不同（记下 " + wasSha + "，现在 " + now + "）");
      }
    }
  }
  return problems;
}
