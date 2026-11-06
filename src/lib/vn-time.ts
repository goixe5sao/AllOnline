/** Date/time in Vietnam time, e.g. "20:00 · Thứ Năm, 12/11/2026" — same on server and browser. */
export function vnEventTime(ms: number): string {
  const tz = "Asia/Ho_Chi_Minh";
  const time = new Date(ms).toLocaleTimeString("vi-VN", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const day = new Date(ms).toLocaleDateString("vi-VN", { timeZone: tz, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  return `${time} · ${day.charAt(0).toUpperCase()}${day.slice(1)}`;
}
