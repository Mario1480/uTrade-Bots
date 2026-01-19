-- Price Follow config on Bot
ALTER TABLE "Bot"
ADD COLUMN "priceFollowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priceSourceExchange" TEXT,
ADD COLUMN "priceSourceSymbol" TEXT,
ADD COLUMN "priceSourceType" TEXT NOT NULL DEFAULT 'TICKER';

-- Normalize existing symbols to canonical BASE/QUOTE format when possible
UPDATE "Bot"
SET "symbol" = REPLACE("symbol", '_', '/')
WHERE "symbol" LIKE '%\_%' ESCAPE '\';

UPDATE "Bot"
SET "symbol" = REPLACE("symbol", '-', '/')
WHERE "symbol" LIKE '%-%';
