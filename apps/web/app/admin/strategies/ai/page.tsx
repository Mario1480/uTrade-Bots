"use client";

import { useTranslations } from "next-intl";
import AiPromptsPage from "../../ai-prompts/page";

export default function AdminAiStrategiesPage() {
  useTranslations("admin.aiPrompts");
  return <AiPromptsPage />;
}
