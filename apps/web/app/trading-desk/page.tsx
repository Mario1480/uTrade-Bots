"use client";

import { useTranslations } from "next-intl";
import TradePage from "../trade/page";

export default function TradingDeskPage() {
  useTranslations("system.trade");
  return <TradePage />;
}
