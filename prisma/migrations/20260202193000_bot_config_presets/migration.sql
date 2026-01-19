CREATE TABLE "BotConfigPreset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "exchange" TEXT,
    "symbol" TEXT,
    "payload" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotConfigPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotConfigPreset_workspaceId_name_key" ON "BotConfigPreset"("workspaceId", "name");

CREATE INDEX "BotConfigPreset_workspaceId_exchange_symbol_idx" ON "BotConfigPreset"("workspaceId", "exchange", "symbol");

ALTER TABLE "BotConfigPreset" ADD CONSTRAINT "BotConfigPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotConfigPreset" ADD CONSTRAINT "BotConfigPreset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
