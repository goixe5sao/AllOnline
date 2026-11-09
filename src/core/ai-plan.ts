import type { StockAlert } from "./stock-alerts";
export type AiPlan = "off" | "basic" | "vip";
export const PLAN_KINDS: Record<AiPlan, readonly StockAlert["kind"][]> = {
  off: [], basic: ["near_resistance", "break_resistance"],
  vip: ["near_resistance", "break_resistance", "near_support", "break_support", "break_equilibrium_down", "break_equilibrium_up"],
};
export const PLAN_LIMIT = { off: 0, basic: 10, vip: 50 };
export const PLAN_LABEL = { off: "Tắt", basic: "Thường", vip: "VIP" };
export const VIP_REASON = "Tính năng VIP. Liên hệ quản trị để nâng cấp.";
export interface PlanUser { role: string; is_guest: boolean; is_demo: boolean; ai_plan?: AiPlan; ai_plan_until?: string | Date | null }
export function effectivePlan(user: PlanUser | null, now = Date.now()): AiPlan {
  if (!user) return "off";
  if (user.role === "app_owner") return "vip";
  if (user.is_guest || user.is_demo) return "off";
  if (user.ai_plan === "vip" && user.ai_plan_until && new Date(user.ai_plan_until).getTime() <= now) return "basic";
  return user.ai_plan ?? "basic";
}
