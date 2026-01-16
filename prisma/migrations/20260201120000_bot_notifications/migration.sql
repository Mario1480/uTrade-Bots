-- CreateTable
CREATE TABLE "BotNotificationConfig" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "fundsWarnEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fundsWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,

    CONSTRAINT "BotNotificationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotNotificationConfig_botId_key" ON "BotNotificationConfig"("botId");

-- AddForeignKey
ALTER TABLE "BotNotificationConfig" ADD CONSTRAINT "BotNotificationConfig_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
