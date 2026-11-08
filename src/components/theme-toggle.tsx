"use client";

import { Sun, Moon } from "lucide-react";
import { Button } from "./ui";
import { useTheme } from "@/lib/theme";

/** Small sun / moon button for headers (switches the whole site). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const light = theme === "light";
  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      onClick={() => set(light ? "dark" : "light")}
      aria-label={light ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng"}
      title={light ? "Giao diện tối" : "Giao diện sáng"}
    >
      {light ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </Button>
  );
}
