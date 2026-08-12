// SDK-free configuration seam for deterministic routes that must not import the Anthropic client.
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
