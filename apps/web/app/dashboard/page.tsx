"use client";

import { useTranslations } from "next-intl";
import HomePage from "../page";

export default function DashboardPage() {
  useTranslations("dashboard");
  return <HomePage />;
}
