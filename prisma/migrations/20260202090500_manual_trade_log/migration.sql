CREATE TABLE "ManualTradeLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "qty" DOUBLE PRECISION,
  "price" DOUBLE PRECISION,
  "notional" DOUBLE PRECISION,
  "postOnly" BOOLEAN,
  "timeInForce" TEXT,
  "clientOrderId" TEXT,
  "exchangeOrderId" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ManualTradeLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualTradeLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualTradeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualTradeLog_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ManualTradeLog_botId_createdAt_idx" ON "ManualTradeLog"("botId", "createdAt");
CREATE INDEX "ManualTradeLog_userId_createdAt_idx" ON "ManualTradeLog"("userId", "createdAt");
