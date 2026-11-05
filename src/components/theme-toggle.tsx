"use client";

import { useTheme } from "@/lib/theme";

/** Small sun / moon button for headers (switches the whole site). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      className={className ?? "theme-toggle"}
      onClick={() => set(light ? "dark" : "light")}
      aria-label={light ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng"}
      title={light ? "Giao diện tối" : "Giao diện sáng"}
    >
      <span aria-hidden>{light ? "🌙" : "☀️"}</span>
    </button>
  );
}
