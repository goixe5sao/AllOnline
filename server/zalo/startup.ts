import type { Config } from "../config";
import type { BotTransport } from "./transport";

/** Discovery never blocks startup; stale configured names stay disabled. */
export function discoverBotAccount(cfg: Config, sender: Pick<BotTransport, "accountName">) {
  cfg.zaloBotId = undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = async () => {
    try {
      const name = await sender.accountName();
      if (!stopped) cfg.zaloBotId = name;
    } catch {
      console.error("[zalo] getMe failed; bot disabled, retrying in 5 minutes");
      if (!stopped) {
        timer = setTimeout(() => void attempt(), 5 * 60_000);
        timer.unref();
      }
    }
  };
  void attempt();
  return () => { stopped = true; clearTimeout(timer); };
}
