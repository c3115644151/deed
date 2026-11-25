import { guard, fail } from "../session.mjs";

// 推翻一条结论也是闸：面板上每条结论旁边那一下。命令行不再提供。
export default function judge() {
    guard(() => {
      fail(
        "推翻结论不在命令行做：打开面板（deed panel）在验收屏对着那条结论按「推翻」，写下为什么。\n" +
          "  账本上会记下谁、什么时候、推翻了哪一条。",
      );
    });
};
