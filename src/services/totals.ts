import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { datesBetween, localDate } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  /** Сумма без учёта скидок (= gross). Оставлено для обратной совместимости. */
  total: number;
  /** Сумма оплаченных заказов до скидки. */
  gross: number;
  /** gross − net. */
  discount: number;
  /** Сколько клиенты фактически заплатили. */
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулями.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(datesBetween(from, to).map((d) => [d, { grossKop: 0, netKop: 0 }]));
    for (const o of rows) {
      // День считаем по смещению зоны в момент заказа: в зонах с переходом на летнее время
      // оно отличается от «сегодняшнего»
      const day = sums.get(localDate(timezone, o.createdAt));
      if (!day) continue;
      day.grossKop += o.amountKop;
      day.netKop += o.amountPaidKop;
    }
    return [...sums].map(([date, { grossKop, netKop }]) => ({
      date,
      total: fromKop(grossKop),
      gross: fromKop(grossKop),
      discount: fromKop(grossKop - netKop),
      net: fromKop(netKop),
    }));
  }
}
