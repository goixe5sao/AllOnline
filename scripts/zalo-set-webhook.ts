/** Explicit operator command. Never imported by the server; no automatic registration. */
import { BotTransport } from "../server/zalo/transport";

async function main() {
  // Deliberately use only explicitly supplied environment variables, not .env.local.
  const token = process.env.ZALO_BOT_TOKEN?.trim();
  const secret = process.env.ZALO_BOT_WEBHOOK_SECRET?.trim();
  if (!token || !secret || secret.length < 8 || secret.length > 256) {
    throw new Error("Supply ZALO_BOT_TOKEN and ZALO_BOT_WEBHOOK_SECRET (8-256 characters).");
  }
  const url = "https://sankhau.pro.vn/api/zalo/bot-webhook";
  if (!process.argv.includes("--apply")) {
    console.log(`Dry run: setWebhook -> ${url}. Pass --apply to register.`);
    return;
  }
  const result = await new BotTransport(token).call("setWebhook", { url, secret_token: secret });
  if (result?.verification?.ok !== true) throw new Error("Webhook saved, but verification failed or was absent. Check the endpoint before use.");
  console.log("Webhook registered and verified.");
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Webhook registration failed");
  process.exitCode = 1;
});
