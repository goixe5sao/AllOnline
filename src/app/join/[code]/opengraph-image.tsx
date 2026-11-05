import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";
import { MAP_INFO } from "@/core/maps";
import { getInviteMeta } from "@/lib/home-data";
import { vnEventTime } from "@/lib/vn-time";

export const alt = "Sự kiện trên AllOnline — sân khấu 3D";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Be Vietnam Pro (SIL OFL, assets/fonts/OFL.txt): full Vietnamese diacritics.
const font = readFile(join(process.cwd(), "assets/fonts/BeVietnamPro-Bold.ttf"));

/** Share image for one invite link: event name, start time, stage type. */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  const m = await getInviteMeta(code);
  const name = m?.name ?? "Phòng sân khấu 3D";
  const when = m?.startsAt ? vnEventTime(m.startsAt) : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          color: "#f4f6ff",
          fontFamily: "BeVietnam",
          background: "radial-gradient(70% 60% at 50% 0%, #1d3b8a 0%, #0b0d24 60%), linear-gradient(#0b0d24, #05060f)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#3df5ff,#8b5cff 50%,#ff4fd8)", display: "flex" }} />
          <span>AllOnline · Sân khấu 3D</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {when && (
            <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 22px", borderRadius: 999, background: "#ffd38a", color: "#1c1633", fontSize: 32 }}>
              🗓 {when}
            </div>
          )}
          <div style={{ display: "flex", fontSize: name.length > 40 ? 64 : 80, lineHeight: 1.1, maxWidth: 1050 }}>{name}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#c3c9ee" }}>
          <span>{m ? MAP_INFO[m.map].name : "Khán phòng 3D trực tuyến"}</span>
          <span>Vào bằng trình duyệt · không cần cài đặt</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "BeVietnam", data: await font, weight: 700, style: "normal" }] },
  );
}
