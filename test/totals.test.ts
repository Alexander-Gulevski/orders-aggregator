import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

const day = (date: string, gross: number, net = gross) => ({ date, total: gross, gross, discount: Math.round((gross - net) * 100) / 100, net });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([day("2026-02-09", 0), day("2026-02-10", 1000), day("2026-02-11", 349)]);
  });

  it("отдаёт gross, discount и net; total = gross для обратной совместимости", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
    await postWebhook(ctx.app, apiOrder({ amount: 500 })); // без скидочных полей — оплачен полностью

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 4000, gross: 4000, discount: 512.5, net: 3487.5 }]);
  });

  it("суммы с копейками не теряют точность", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 0.29, amountPaid: 0.19 }));
    await postWebhook(ctx.app, apiOrder({ amount: 4.35, amountPaid: 4.01 }));
    await postWebhook(ctx.app, apiOrder({ amount: "10.01", amountPaid: "9.99" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 14.65, gross: 14.65, discount: 0.46, net: 14.19 }]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([day("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([day("2026-02-10", 800)]);
  });

  it("день заказа считается по смещению зоны на момент заказа (переход на летнее время)", async () => {
    // Europe/Berlin: до 29.03.2026 01:00Z — UTC+1, после — UTC+2.
    ctx.api.customers.set("c_dst", "Europe/Berlin");
    const at = (createdAt: string, amount: number) => apiOrder({ customerId: "c_dst", amount, createdAt });
    await postWebhook(ctx.app, at("2026-03-27T22:30:00Z", 100)); // 27.03 23:30 CET  → 27-е
    await postWebhook(ctx.app, at("2026-03-27T23:30:00Z", 200)); // 28.03 00:30 CET  → 28-е
    await postWebhook(ctx.app, at("2026-03-30T22:30:00Z", 400)); // 31.03 00:30 CEST → 31-е
    await postWebhook(ctx.app, at("2026-03-30T21:30:00Z", 800)); // 30.03 23:30 CEST → 30-е
    await postWebhook(ctx.app, at("2026-03-31T21:59:59Z", 1600)); // 31.03 23:59:59 CEST → 31-е
    await postWebhook(ctx.app, at("2026-03-31T22:00:00Z", 3200)); // 01.04 00:00 CEST → вне диапазона

    const res = await dailyTotals(ctx.app, "c_dst", "2026-03-27", "2026-03-31");
    expect(res.json()).toEqual([
      day("2026-03-27", 100),
      day("2026-03-28", 200),
      day("2026-03-29", 0),
      day("2026-03-30", 800),
      day("2026-03-31", 2000),
    ]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});
