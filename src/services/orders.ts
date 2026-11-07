import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Числа внешний API отдаёт и числом, и строкой ("250.10", "33") — как для amount, так и для скидочных полей. */
const Numeric = z.union([z.number(), z.string()]);

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: Numeric,
  // Появились в API недавно: старые версии заказов (и, возможно, часть вебхуков) приходят без них
  discountPercent: Numeric.nullish(),
  amountPaid: Numeric.nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

/**
 * Сколько фактически оплачено, в копейках.
 * Приоритет — `amountPaid`: это факт из платёжной системы. Если его нет, считаем по `discountPercent`
 * (округляя до копейки), а без скидочных полей вовсе — заказ оплачен полностью.
 */
function amountPaidKop(amountKop: number, discountPercent: unknown, amountPaid: unknown): number {
  if (amountPaid !== null && amountPaid !== undefined) {
    const paid = toKop(parseRub(amountPaid));
    if (paid > amountKop) throw new Error(`amountPaid ${paid} exceeds amount ${amountKop}`);
    return paid;
  }
  const percent = parsePercent(discountPercent);
  return percent ? Math.round((amountKop * (100 - percent)) / 100) : amountKop;
}

/** Скидка в процентах: число или строка с числом, 0..100; null/undefined — скидки нет. */
function parsePercent(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discountPercent: ${JSON.stringify(raw)}`);
  }
  return value;
}

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      // Процент проверяем всегда, даже когда есть amountPaid: мусор в поле — повод отбраковать заказ, а не молча пропустить
      parsePercent(o.discountPercent);
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        amountPaidKop: amountPaidKop(amountKop, o.discountPercent, o.amountPaid),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt). Проверка атомарна на стороне БД.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.saveIfNewer(this.normalize(raw));
  }
}
