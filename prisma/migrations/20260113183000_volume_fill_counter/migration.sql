-- AlterTable
ALTER TABLE "BotFillCursor" DROP COLUMN "lastTradeId",
ADD COLUMN     "lastTradeTimeMs" BIGINT;

-- CreateIndex
CREATE INDEX "BotFillSeen_botId_symbol_idx" ON "BotFillSeen"("botId", "symbol");
