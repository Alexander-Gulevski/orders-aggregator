-- Скидки из внешнего API: сколько клиент фактически заплатил (копейки).
-- Для уже сохранённых заказов скидка неизвестна — считаем, что оплачено полностью.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
UPDATE orders SET amount_paid_kop = amount_kop;
ALTER TABLE orders ALTER COLUMN amount_paid_kop SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_amount_paid_kop_nonneg CHECK (amount_paid_kop >= 0);
