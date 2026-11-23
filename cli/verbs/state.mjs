import { guard, printState } from "../session.mjs";

export default function state() {
    guard(printState);
};
