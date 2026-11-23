// 给人看的时间：账本里存 UTC，纸上与终端里按本机时区显示。
// 这里只做格式化，不读时钟——"现在"由调用方给。

export const stamp0 = (at) => {
  if (!at) return "—";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const fileStamp = (at) => stamp0(at).replace(/[-: ]/g, "");
