-- CreateTable
CREATE TABLE "RunnerStatus" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastTickAt" TIMESTAMP(3) NOT NULL,
    "botsRunning" INTEGER NOT NULL,
    "botsErrored" INTEGER NOT NULL,
    "version" TEXT,

    CONSTRAINT "RunnerStatus_pkey" PRIMARY KEY ("id")
);
