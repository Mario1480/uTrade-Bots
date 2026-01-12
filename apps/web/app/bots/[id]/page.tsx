"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";

export default function BotPage() {
  const params = useParams();
  const id = params.id as string; // ✅ korrekt für Next 15

  const [bot, setBot] = useState<any>(null);
  const [rt, setRt] = useState<any>(null);
  const [saving, setSaving] = useState("");

  const [mm, setMm] = useState<any>(null);
  const [vol, setVol] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);

  async function loadAll() {
    const b = await apiGet<any>(`/bots/${id}`);
    setBot(b);
    setMm(b.mmConfig);
    setVol(b.volConfig);
    setRisk(b.riskConfig);
  }

  async function loadRuntime() {
    const r = await apiGet<any>(`/bots/${id}/runtime`);
    setRt(r);
  }

  useEffect(() => {
    if (!id) return;
    loadAll();
    loadRuntime();
    const t = setInterval(loadRuntime, 1200);
    return () => clearInterval(t);
  }, [id]);

  const canSave = useMemo(() => mm && vol && risk, [mm, vol, risk]);

  async function save() {
    if (!canSave) return;
    setSaving("saving...");
    await apiPut(`/bots/${id}/config`, { mm, vol, risk });
    setSaving("saved");
    setTimeout(() => setSaving(""), 1200);
  }

  async function start() {
    await apiPost(`/bots/${id}/start`);
    await loadAll();
  }
  async function pause() {
    await apiPost(`/bots/${id}/pause`);
    await loadAll();
  }
  async function stop() {
    await apiPost(`/bots/${id}/stop`);
    await loadAll();
  }

  if (!bot || !mm || !vol || !risk) return <div>Loading…</div>;

  return (
    <div>
      <h2>{bot.name}</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={start}>Start</button>
        <button onClick={pause}>Pause</button>
        <button onClick={stop}>Stop</button>
        <span>Status: <b>{bot.status}</b></span>
      </div>

      <pre>{JSON.stringify(rt, null, 2)}</pre>

      <button onClick={save} disabled={!canSave}>Save Config</button>
      <span>{saving}</span>
    </div>
  );
}