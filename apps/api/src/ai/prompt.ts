export function buildAiPrompt(payload: any): string {
  const schema = {
    severity: "info|warning|critical",
    category: "spread|inventory|volume|risk|price_follow",
    title: "string",
    message: "string",
    recommendation: "string",
    confidence: "low|medium|high",
    evidence: "object",
    suggestedConfig: {
      mm: "optional object of partial mm config values",
      vol: "optional object of partial vol config values",
      risk: "optional object of partial risk config values"
    },
    impactEstimate: {
      expectedSpreadChangePct: "optional number",
      expectedInventoryDriftReduction: "low|medium|high",
      expectedVolumeProgress: "low|medium|high"
    }
  };

  return [
    "You are a read-only advisor for a crypto market-making bot.",
    "Never suggest actions that would execute trades automatically.",
    "Return a JSON array of insight objects ONLY. No markdown, no extra text.",
    "Each insight MUST include severity, category, title, message, recommendation, confidence, evidence.",
    "Optional: suggestedConfig and impactEstimate. If unsure, omit them.",
    `Schema: ${JSON.stringify(schema)}`,
    "\nInput data (summaries, not raw ticks):",
    JSON.stringify(payload)
  ].join("\n");
}
