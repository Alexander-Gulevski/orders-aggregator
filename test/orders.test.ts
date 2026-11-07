import { describe, expect, it } from "vitest";
import { OrdersService } from "../src/services/orders.js";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();
const svc = new OrdersService(null as never);

describe("OrdersService.normalize — скидки", () => {
  it("amountPaid — фактическая оплата, amount — до скидки", () => {
    const o = svc.normalize(apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
    expect(o.amountKop).toBe(250000);
    expect(o.amountPaidKop).toBe(208750);
  });

  it("amountPaid строкой", () => {
    expect(svc.normalize(apiOrder({ amount: "2500.00", amountPaid: "2087.50" })).amountPaidKop).toBe(208750);
  });

  it("без скидочных полей заказ оплачен полностью", () => {
    const o = svc.normalize(apiOrder({ amount: 1000 }));
    expect(o.amountPaidKop).toBe(100000);
    expect(svc.normalize(apiOrder({ amount: 1000, discountPercent: null, amountPaid: null })).amountPaidKop).toBe(100000);
  });

  it("нет amountPaid — считаем по discountPercent с округлением до копейки", () => {
    expect(svc.normalize(apiOrder({ amount: 1000, discountPercent: 10 })).amountPaidKop).toBe(90000);
    // 33.33 * (1 - 0.15) = 28.3305 → 28.33
    expect(svc.normalize(apiOrder({ amount: 33.33, discountPercent: 15 })).amountPaidKop).toBe(2833);
    expect(svc.normalize(apiOrder({ amount: 1000, discountPercent: 0 })).amountPaidKop).toBe(100000);
  });

  it("discountPercent строкой — как и amount", () => {
    expect(svc.normalize(apiOrder({ amount: 3312, discountPercent: "33", amountPaid: 2219.04 })).amountPaidKop).toBe(221904);
    expect(svc.normalize(apiOrder({ amount: 1000, discountPercent: "10" })).amountPaidKop).toBe(90000);
    expect(() => svc.normalize(apiOrder({ amount: 1000, discountPercent: "abc" }))).toThrow();
  });

  it("amountPaid приоритетнее discountPercent", () => {
    expect(svc.normalize(apiOrder({ amount: 1000, discountPercent: 50, amountPaid: 700 })).amountPaidKop).toBe(70000);
  });

  it("невалидные скидки — ошибка", () => {
    expect(() => svc.normalize(apiOrder({ amount: 1000, amountPaid: 1000.01 }))).toThrow();
    expect(() => svc.normalize(apiOrder({ amount: 1000, amountPaid: -1 }))).toThrow();
    expect(() => svc.normalize(apiOrder({ amount: 1000, discountPercent: 101 }))).toThrow();
    expect(() => svc.normalize(apiOrder({ amount: 1000, discountPercent: -1 }))).toThrow();
  });
});

describe("OrdersService.apply — параллельные доставки", () => {
  it("при одновременной доставке версий побеждает самая свежая", async () => {
    const base = apiOrder({ status: "pending", updatedAt: "2026-02-10T12:00:00Z" });
    const versions = [
      { ...base, status: "refunded", updatedAt: "2026-02-12T00:00:00Z" },
      { ...base, status: "paid", updatedAt: "2026-02-11T00:00:00Z" },
      base,
      { ...base, status: "paid", updatedAt: "2026-02-11T00:00:00Z" },
    ];
    for (let round = 0; round < 5; round++) {
      await ctx.db.query(`TRUNCATE orders`);
      await Promise.all(versions.map((v) => postWebhook(ctx.app, v)));
      const { rows } = await ctx.db.query(`SELECT status, updated_at FROM orders WHERE id = $1`, [base.id]);
      expect(rows[0].status).toBe("refunded");
      expect(rows[0].updated_at.toISOString()).toBe("2026-02-12T00:00:00.000Z");
    }
  });

  it("повтор той же версии — stale, более новая — updated", async () => {
    const o = apiOrder({ status: "pending" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "created" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" })).json()).toEqual({ result: "updated" });
  });
});
