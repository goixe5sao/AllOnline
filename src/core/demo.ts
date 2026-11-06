/**
 * "Phòng trải nghiệm": always-open rooms where anyone can try Sân Khấu Online before signing up.
 *  - each person (device, and network as a backstop) gets DEMO minutes per day (Vietnam day);
 *  - one person at a time may be the "demo host" (room-owner controls, minus anything risky);
 *  - without a host the stage screen runs a showcase loop; when the host leaves, the room resets.
 */
import type { ScreenContent } from "./screen";

export const DEMO_TEXTS = [
  "Chào mừng quý khách đến với Sân Khấu Online 🎉",
  "Đêm nhạc Acoustic — 20:00 tối nay 🎸",
  "Hội thảo: Đầu tư chứng khoán thông minh 2026 📈",
  "Chúc mừng sinh nhật! 🎂🎈",
  "Giải lao 10 phút — quay lại ngay ☕",
  "Cảm ơn mọi người đã tham gia! ❤️",
];

export const DEMO_IMAGES: { url: string; label: string }[] = [
  { url: "/maps/hall.webp", label: "Hội trường ghế ngồi" },
  { url: "/maps/carpet.webp", label: "Khu thảm ngồi" },
  { url: "/maps/tables.webp", label: "Khu bàn" },
  { url: "/maps/drive_in.webp", label: "Rạp chiếu ngoài trời" },
  { url: "/og.png", label: "Biểu trưng Sân Khấu Online" },
];

/** What the stage shows by itself while nobody is the host (one step every DEMO_SHOWCASE_MS). */
export const DEMO_SHOWCASE: ScreenContent[] = [
  { kind: "text", text: "Phòng trải nghiệm 👋 Bấm “Vào làm chủ phòng” để tự điều khiển màn hình này" },
  { kind: "chart", symbol: "VNINDEX", source: "demo", interval: "1", chartType: "candles", indicators: ["volume", "ma20"] },
  { kind: "image", url: "/maps/hall.webp" },
  { kind: "text", text: "Chiếu YouTube · live camera · biểu đồ chứng khoán · bình chọn — cho cả phòng cùng lúc" },
];
export const DEMO_SHOWCASE_MS = 25_000;

/** "Trang web tự cuộn" in a demo room always shows this page (no link to type). */
export const DEMO_WEB_URL = "https://goixe5sao.vn/";
const isDemoWebHost = (url: string) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "goixe5sao.vn" || h.endsWith(".goixe5sao.vn");
  } catch {
    return false;
  }
};

/** Several people on one office / mobile network can try, but not endlessly from new private tabs. */
export const DEMO_PEOPLE_PER_NETWORK = 6;

/** Text / pictures on screen come from the library (YouTube links are free, charts are data, the web page is goixe5sao.vn). */
export function demoContentAllowed(c: ScreenContent): boolean {
  switch (c.kind) {
    case "text":
      return DEMO_TEXTS.includes(c.text);
    case "image":
      return DEMO_IMAGES.some((i) => i.url === c.url);
    case "web":
      return isDemoWebHost(c.url);
    case "audio":
    case "chat":
      return false;
    default:
      return true;
  }
}

/** "2026-11-06" in Vietnam time — the day the minutes are counted in. */
export function demoDay(now: number): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Seconds left today, from the device's and the network's use. */
export function demoSecondsLeft(limitSec: number, usedByDevice: number, usedByNetwork: number): number {
  return Math.max(0, Math.min(limitSec - usedByDevice, limitSec * DEMO_PEOPLE_PER_NETWORK - usedByNetwork));
}

export interface DemoDto {
  /** Who is the demo host now (null = free). */
  hostId: string | null;
  hostName: string | null;
  /** Your seconds left today when this was sent (counts down while you are in the room, not while waiting). */
  leftSec: number;
  limitSec: number;
  /** Is this connection exempt (the real room owner / app owner)? */
  unlimited: boolean;
}

/** One demo room as listed on the home page. */
export interface DemoRoomInfo {
  id: string;
  name: string;
  map: string;
  inviteCode: string;
  seats: number;
  seated: number;
  waiting: number;
  hostName: string | null;
  hostLeftSec: number | null;
}
