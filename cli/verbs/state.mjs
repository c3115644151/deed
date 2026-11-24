import { guard, parse, printState } from "../session.mjs";

export default function state(argv) {
    // 只读动词也过开关表：带了不认的开关要说出口，不能照常把状态印一遍。
    parse(argv, "state");
    guard(printState);
};
