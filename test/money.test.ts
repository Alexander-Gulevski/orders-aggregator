import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});

describe("toKop — точность double", () => {
  it("не теряет копейку на суммах, где rub * 100 не целое в double", () => {
    // 0.29 * 100 === 28.999999999999996, 4.35 * 100 === 434.99999999999994
    expect(toKop(0.29)).toBe(29);
    expect(toKop(4.35)).toBe(435);
    expect(toKop(1.1)).toBe(110);
    expect(toKop(1099.95)).toBe(109995);
    expect(toKop(2087.5)).toBe(208750);
  });

  it("по-прежнему отбрасывает настоящие доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
    expect(toKop(0.005)).toBe(0);
  });
});
