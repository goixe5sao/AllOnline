import Anthropic from "@anthropic-ai/sdk";
let shared: { key: string; client: Anthropic } | undefined;
/** Same server-only credential and client for receipts and commentary. */
export function anthropicClient(apiKey: string): Anthropic {
  if (shared?.key !== apiKey) shared = { key: apiKey, client: new Anthropic({ apiKey }) };
  return shared.client;
}
