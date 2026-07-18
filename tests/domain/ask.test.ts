import { test, expect, describe } from "bun:test";
import {
  OTHER,
  askOptions,
  toggleIndex,
  splitOther,
  isLastQuestion,
  formatAnswers,
  echoAnswers,
} from "../../src/domain/ask.ts";
import type { AskQuestion } from "../../src/session/claude-session.ts";

const q = (over: Partial<AskQuestion> = {}): AskQuestion => ({
  question: "Pick one",
  header: "Choice",
  options: [
    { label: "Red", description: "the warm one" },
    { label: "Blue" },
  ],
  ...over,
});

describe("askOptions", () => {
  test("maps the model's options and appends a typeable Other", () => {
    const opts = askOptions(q());
    expect(opts).toEqual([
      { name: "Red", description: "the warm one", value: "Red" },
      { name: "Blue", description: "", value: "Blue" }, // missing description → ""
      { name: "Other…", description: "type your own answer", value: OTHER },
    ]);
  });
});

describe("toggleIndex", () => {
  test("adds a missing index, preserving insertion order", () => {
    expect(toggleIndex([], 2)).toEqual([2]);
    expect(toggleIndex([2], 0)).toEqual([2, 0]);
  });
  test("removes an already-selected index", () => {
    expect(toggleIndex([2, 0], 2)).toEqual([0]);
  });
});

describe("splitOther", () => {
  test("separates the Other sentinel from concrete labels", () => {
    const opts = askOptions(q());
    expect(splitOther([opts[0]!, opts[2]!])).toEqual({ labels: ["Red"], other: true });
  });
  test("no Other checked → other:false", () => {
    const opts = askOptions(q());
    expect(splitOther([opts[0]!, opts[1]!])).toEqual({ labels: ["Red", "Blue"], other: false });
  });
});

describe("isLastQuestion", () => {
  test("true only on the final index", () => {
    expect(isLastQuestion(3, 0)).toBe(false);
    expect(isLastQuestion(3, 2)).toBe(true);
    expect(isLastQuestion(1, 0)).toBe(true);
  });
});

describe("formatAnswers / echoAnswers", () => {
  test("single-label answers across questions", () => {
    const ans = [
      { header: "Choice", labels: ["Red"] },
      { header: "Size", labels: ["Large"] },
    ];
    expect(formatAnswers(ans)).toBe("The user selected — Choice: Red; Size: Large");
    expect(echoAnswers(ans)).toBe("answered: Choice=Red, Size=Large");
  });
  test("multi-label answer joins the labels with a comma", () => {
    const ans = [{ header: "Toppings", labels: ["Cheese", "Ham", "Custom sauce"] }];
    expect(formatAnswers(ans)).toBe("The user selected — Toppings: Cheese, Ham, Custom sauce");
    expect(echoAnswers(ans)).toBe("answered: Toppings=Cheese, Ham, Custom sauce");
  });
});
