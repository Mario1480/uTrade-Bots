-- Store Telegram chat ids per user instead of only global config.
ALTER TABLE "User"
ADD COLUMN "telegramChatId" TEXT;
