"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet } from "../../lib/api";

type SystemSettings = {
  tradingEnabled: boolean;
  readOnlyMode: boolean;
};

const defaultSettings: SystemSettings = { tradingEnabled: true, readOnlyMode: false };

export function useSystemSettings() {
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);

  useEffect(() => {
    let mounted = true;
    apiGet<SystemSettings>("/system/settings")
      .then((res) => {
        if (mounted) setSettings(res);
      })
      .catch(() => {
        if (mounted) setSettings(defaultSettings);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return settings;
}

export default function SystemBanner() {
  const t = useTranslations("system.maintenance");
  const settings = useSystemSettings();
  if (!settings.readOnlyMode) return null;

  return (
    <div className="card" style={{ padding: "8px 12px", margin: "10px auto", maxWidth: 980 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("title")}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {t("description")}
      </div>
    </div>
  );
}
