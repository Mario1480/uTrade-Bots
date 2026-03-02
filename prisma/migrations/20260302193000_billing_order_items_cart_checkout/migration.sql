CREATE TABLE "billing_order_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price_cents" INTEGER NOT NULL,
  "line_amount_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "kind_snapshot" "BillingPackageKind" NOT NULL,
  "package_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_order_items_order_idx" ON "billing_order_items"("order_id");
CREATE INDEX "billing_order_items_package_idx" ON "billing_order_items"("package_id");

ALTER TABLE "billing_order_items"
  ADD CONSTRAINT "billing_order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_order_items"
  ADD CONSTRAINT "billing_order_items_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "billing_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
