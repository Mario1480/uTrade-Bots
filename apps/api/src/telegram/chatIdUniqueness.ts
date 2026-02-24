export type TelegramChatIdConflictKind = "user" | "global";

export const TELEGRAM_CHAT_ID_IN_USE_ERROR = {
  error: "telegram_chat_id_in_use",
  message: "Telegram chat ID is already in use.",
  details: "Already used by another user or global telegram config."
} as const;

export function normalizeTelegramChatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === "P2002"
  );
}

export async function findTelegramChatIdConflict(params: {
  chatId: string | null;
  currentUserId?: string | null;
  includeGlobal?: boolean;
  deps: {
    findUserByChatId: (input: {
      chatId: string;
      excludingUserId: string | null;
    }) => Promise<{ id: string } | null>;
    getGlobalChatId: () => Promise<string | null>;
  };
}): Promise<TelegramChatIdConflictKind | null> {
  if (!params.chatId) return null;
  const excludingUserId = params.currentUserId ?? null;
  const includeGlobal = params.includeGlobal !== false;

  const userConflict = await params.deps.findUserByChatId({
    chatId: params.chatId,
    excludingUserId
  });
  if (userConflict) return "user";

  if (!includeGlobal) return null;
  const globalChatId = normalizeTelegramChatId(await params.deps.getGlobalChatId());
  if (globalChatId && globalChatId === params.chatId) return "global";

  return null;
}
