"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

export default function LogoutButton() {
  const tNav = useTranslations("nav");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await apiPost("/auth/logout");
    } finally {
      router.push(withLocalePath("/login", locale));
      setLoading(false);
    }
  }

  return (
    <button className="btn" onClick={logout} disabled={loading}>
      {loading ? tNav("loggingOut") : tNav("logout")}
    </button>
  );
}
