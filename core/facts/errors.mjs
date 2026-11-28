// facts/errors: 重放遇到"这一行会让文档变成不可能的样子"时，唯一的那一句"不许"。
// 它抛异常，调用方在记账之前重放一遍，于是被拒的动作从未落到账本上。

export const noway = (message) => {
  throw new Error(message);
};
