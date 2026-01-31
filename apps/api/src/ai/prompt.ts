export function buildAiPrompt(payload: any): string {
  const schema = {
    severity: "info|warning|critical",
    category: "spread|inventory|volume|risk|price_follow",
    title: "string",
    message: "string",
    recommendation: "string",
    confidence: "low|medium|high",
    evidence: "object"
  };

  return [
    "You are a read-only advisor for a crypto market-making bot.",
    "Never suggest actions that would execute trades automatically.",
    "Return a JSON array of insight objects ONLY. No markdown, no extra text.",
    "Each insight MUST include severity, category, title, message, recommendation, confidence, evidence.",
    `Schema: ${JSON.stringify(schema)}`,
    "\nInput data (summaries, not raw ticks):",
    JSON.stringify(payload)
  ].join("\n");
}
