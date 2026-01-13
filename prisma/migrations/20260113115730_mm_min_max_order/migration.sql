-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mmEnabled" BOOLEAN NOT NULL DEFAULT true,
    "volEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMakingConfig" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "spreadPct" DOUBLE PRECISION NOT NULL,
    "maxSpreadPct" DOUBLE PRECISION NOT NULL DEFAULT 0.0015,
    "levelsUp" INTEGER NOT NULL,
    "levelsDown" INTEGER NOT NULL,
    "budgetQuoteUsdt" DOUBLE PRECISION NOT NULL,
    "budgetBaseToken" DOUBLE PRECISION NOT NULL,
    "minOrderUsdt" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "maxOrderUsdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distribution" TEXT NOT NULL,
    "jitterPct" DOUBLE PRECISION NOT NULL,
    "skewFactor" DOUBLE PRECISION NOT NULL,
    "maxSkew" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MarketMakingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeConfig" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "dailyNotionalUsdt" DOUBLE PRECISION NOT NULL,
    "minTradeUsdt" DOUBLE PRECISION NOT NULL,
    "maxTradeUsdt" DOUBLE PRECISION NOT NULL,
    "activeFrom" TEXT NOT NULL,
    "activeTo" TEXT NOT NULL,
    "mode" TEXT NOT NULL,

    CONSTRAINT "VolumeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskConfig" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "minUsdt" DOUBLE PRECISION NOT NULL,
    "maxDeviationPct" DOUBLE PRECISION NOT NULL,
    "maxOpenOrders" INTEGER NOT NULL,
    "maxDailyLoss" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RiskConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotRuntime" (
    "botId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "mid" DOUBLE PRECISION,
    "bid" DOUBLE PRECISION,
    "ask" DOUBLE PRECISION,
    "openOrders" INTEGER,
    "openOrdersMm" INTEGER,
    "openOrdersVol" INTEGER,
    "lastVolClientOrderId" TEXT,
    "freeUsdt" DOUBLE PRECISION,
    "freeBase" DOUBLE PRECISION,
    "tradedNotionalToday" DOUBLE PRECISION,

    CONSTRAINT "BotRuntime_pkey" PRIMARY KEY ("botId")
);

-- CreateTable
CREATE TABLE "CexConfig" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "apiMemo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CexConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertConfig" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "telegramBotToken" TEXT,
    "telegramChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BotAlert" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketMakingConfig_botId_key" ON "MarketMakingConfig"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeConfig_botId_key" ON "VolumeConfig"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskConfig_botId_key" ON "RiskConfig"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "CexConfig_exchange_key" ON "CexConfig"("exchange");

-- CreateIndex
CREATE INDEX "BotAlert_botId_createdAt_idx" ON "BotAlert"("botId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketMakingConfig" ADD CONSTRAINT "MarketMakingConfig_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeConfig" ADD CONSTRAINT "VolumeConfig_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskConfig" ADD CONSTRAINT "RiskConfig_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotRuntime" ADD CONSTRAINT "BotRuntime_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAlert" ADD CONSTRAINT "BotAlert_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
