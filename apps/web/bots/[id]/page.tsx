"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";

export default function LegacyBotPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const bot = await apiGet<{ status: string }>(`/bots/${params.id}`);
        if (!mounted) return;
        setStatus(bot.status);
      } catch {
        if (!mounted) return;
        setStatus("unavailable");
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [params.id]);

  return (
    <main>
      <h1>Bot {params.id}</h1>
      <p>Status: {status}</p>
    </main>
  );
}
