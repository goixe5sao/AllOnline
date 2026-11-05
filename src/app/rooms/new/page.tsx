"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, useApi } from "@/lib/api";
import { AVATARS, type AvatarGroup, type MapCode } from "@/core/maps";
import { formatVnd, type Quote } from "@/core/pricing";
import { parseYouTubeId } from "@/core/screen";
import { CHART_INTERVALS, INTERVAL_LABEL, type ChartInterval } from "@/core/market";
import type { SlotBudget } from "@/core/slots";

interface Catalog {
  maps: { code: MapCode; name: string; description: string; groups: AvatarGroup[]; enabled: boolean }[];
  avatars: { group: AvatarGroup; label: string; enabled: boolean }[];
  durationOptions: number[];
  waitingRatio: number;
  maxRoomCapacity: number;
  trial: { enabled: boolean; maxHours: number; maxCapacity: number };
  openEnded: { enabled: boolean; deposit: number };
}

interface Preview {
  waitingCapacity: number;
  totalSlots: number;
  waitingRatio: number;
  quote: Quote | null;
  promoError: string | null;
  budget: SlotBudget;
  trial: { eligible: boolean; reason?: string; used: number };
}

function CreateRoomForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [map, setMap] = useState<MapCode>(catalog.maps.find((m) => m.enabled)?.code ?? "hall");
  const [groups, setGroups] = useState<AvatarGroup[]>(["people"]);
  const [capacity, setCapacity] = useState(20);
  const [waitingEnabled, setWaitingEnabled] = useState(true);
  const [entryMode, setEntryMode] = useState<"auto_assign" | "gate_entry">("auto_assign");
  const [hours, setHours] = useState(catalog.durationOptions[0] ?? 6);
  // "Mở vô thời hạn – đến khi tắt": deposit now, settled by hours used when the room is closed.
  const [openEnded, setOpenEnded] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [stageStyle, setStageStyle] = useState<"glam" | "plain">("glam");
  const [password, setPassword] = useState("");
  const [screenKind, setScreenKind] = useState<"text" | "youtube" | "chart" | "blank">("text");
  const [screenValue, setScreenValue] = useState("Chào mừng đến với phòng!");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("D");
  const [useTrial, setUseTrial] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const mapInfo = catalog.maps.find((m) => m.code === map)!;
  const allowedGroups = mapInfo.groups.filter((g) => catalog.avatars.find((a) => a.group === g)?.enabled);
  const allowedFor = (m: MapCode) => catalog.maps.find((x) => x.code === m)!.groups.filter((g) => catalog.avatars.find((a) => a.group === g)?.enabled);
  const chooseMap = (m: MapCode) => {
    setMap(m);
    const allowed = allowedFor(m);
    setGroups((gs) => {
      const kept = gs.filter((g) => allowed.includes(g));
      return kept.length ? kept : allowed.slice(0, 1);
    });
  };

  const durationChoices = useTrial ? Array.from(new Set([...catalog.durationOptions.filter((h) => h <= catalog.trial.maxHours), catalog.trial.maxHours])).sort((a, b) => a - b) : catalog.durationOptions;

  const initialScreen = useMemo(() => {
    if (screenKind === "text") return screenValue.trim() ? { kind: "text", text: screenValue.trim() } : undefined;
    if (screenKind === "youtube") {
      const id = parseYouTubeId(screenValue);
      return id ? { kind: "youtube", videoId: id } : undefined;
    }
    if (screenKind === "chart") return { kind: "chart", symbol: (screenValue.trim() || "VNINDEX").toUpperCase(), source: "demo", interval: chartInterval, indicators: ["volume", "ma20"] };
    return undefined;
  }, [screenKind, screenValue, chartInterval]);

  const config = { name: name || "Phòng mới", description, map, avatarGroups: groups, officialCapacity: capacity, waitingEnabled, entryMode, durationHours: hours, openEnded: openEnded && !useTrial, isPublic, password, initialScreen, scheduledAt: startsAt ? new Date(startsAt).getTime() : null, stageStyle };

  useEffect(() => {
    const id = setTimeout(() => {
      if (!Number.isInteger(capacity) || capacity < 1 || !groups.length) return;
      api<Preview>("/api/rooms/quote", { body: { ...config, promoCode: promo || undefined } })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, waitingEnabled, hours, openEnded, useTrial, map, groups.join(","), promo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ roomId?: string; orderId?: string }>("/api/rooms", { body: { config, useTrial, promoCode: useTrial ? undefined : promo || undefined } });
      if (r.roomId) router.push(`/room/${r.roomId}`);
      else router.push(`/orders/${r.orderId}`);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const b = preview?.budget;
  const over = preview && b ? preview.totalSlots > b.remaining : false;

  return (
    <form className="grid grid-2" onSubmit={submit} style={{ alignItems: "start" }}>
      <div className="card stack">
        <h2>Cấu hình phòng</h2>
        <label className="field">
          Tên phòng
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label className="field">
          Mô tả
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
        </label>
        <div className="field">
          <strong>MAP</strong>
          <div className="choice-grid">
            {catalog.maps.map((m) => (
              <button type="button" key={m.code} className="choice" aria-pressed={map === m.code} disabled={!m.enabled} onClick={() => chooseMap(m.code)}>
                <strong>{m.name}</strong>
                <br />
                <small>{m.description}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <strong>Nhóm đối tượng đại diện được phép</strong>
          <div className="row">
            {allowedGroups.map((g) => (
              <label className="check" key={g}>
                <input type="checkbox" checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} />
                {AVATARS[g].label}
              </label>
            ))}
          </div>
          {map === "drive_in" && <small>Rạp ngoài trời chỉ dùng nhóm xe; người tham dự chọn mẫu xe và xem từ ghế lái.</small>}
        </div>
        <label className="field">
          Số chỗ chính thức
          <input type="number" min={1} max={catalog.maxRoomCapacity} value={capacity} onChange={(e) => setCapacity(Math.floor(Number(e.target.value)))} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={waitingEnabled} onChange={(e) => setWaitingEnabled(e.target.checked)} /> Cho người chờ ngoài cổng (tỷ lệ {Math.round(catalog.waitingRatio * 100)}%)
        </label>
        <div className="field">
          <strong>Chế độ vào phòng</strong>
          <div className="choice-grid">
            <button type="button" className="choice" aria-pressed={entryMode === "auto_assign"} onClick={() => setEntryMode("auto_assign")}>
              <strong>Tự xếp chỗ</strong>
              <br />
              <small>Xếp vào chỗ trống gần màn hình nhất; có nút “Đổi chỗ”.</small>
            </button>
            <button type="button" className="choice" aria-pressed={entryMode === "gate_entry"} onClick={() => setEntryMode("gate_entry")}>
              <strong>Vào từ cổng</strong>
              <br />
              <small>Tự đi/lái đến chỗ trống và bấm “Vào chỗ”; có thời gian tìm chỗ.</small>
            </button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Hiện phòng trên trang chủ AllOnline (ai cũng thấy và bấm vào được; đổi lại bất cứ lúc nào)
        </label>
        <div className="field">
          Kiểu sân khấu <small>(đổi được bất cứ lúc nào trong phòng)</small>
          <div className="row" role="radiogroup" aria-label="Kiểu sân khấu">
            {(
              [
                ["glam", "🛸 Hành tinh tương lai", "Rèm đèn LED, vòm hologram, đèn quét, bầu trời hành tinh & cực quang — bật/tắt đèn trong phòng"],
                ["plain", "◻ Đơn sắc", "Hội trường sáng, gọn, nhẹ máy"],
              ] as const
            ).map(([v, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={stageStyle === v} className={`choice ${stageStyle === v ? "on" : ""}`} onClick={() => setStageStyle(v)}>
                <strong>{t}</strong>
                <br />
                <small>{d}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          Giờ bắt đầu sự kiện <small>(không bắt buộc — trang mời hiện đếm ngược, khách bấm “Nhắc tôi” để bot Zalo nhắc)</small>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="field">
          Mật mã phòng <small>(không bắt buộc)</small>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="off" />
        </label>
        <div className="field">
          <strong>Nội dung màn hình ban đầu</strong>
          <div className="row">
            <select value={screenKind} onChange={(e) => setScreenKind(e.target.value as typeof screenKind)} style={{ width: "auto" }}>
              <option value="text">Văn bản</option>
              <option value="youtube">Video YouTube</option>
              <option value="chart">Biểu đồ chứng khoán (dữ liệu thật mỗi phút)</option>
              <option value="blank">Để trống</option>
            </select>
            {screenKind !== "blank" && (
              <input
                type="text"
                value={screenValue}
                onChange={(e) => setScreenValue(e.target.value)}
                placeholder={screenKind === "youtube" ? "Link YouTube" : screenKind === "chart" ? "Mã, ví dụ VNINDEX" : "Nội dung"}
                style={{ flex: 1 }}
              />
            )}
            {screenKind === "chart" && (
              <select value={chartInterval} onChange={(e) => setChartInterval(e.target.value as ChartInterval)} style={{ width: "auto" }} aria-label="Khung thời gian">
                {CHART_INTERVALS.map((iv) => (
                  <option key={iv} value={iv}>
                    Nến {INTERVAL_LABEL[iv]}
                  </option>
                ))}
              </select>
            )}
          </div>
          {screenKind === "youtube" && screenValue && !initialScreen && <small style={{ color: "var(--danger)" }}>Link YouTube không hợp lệ.</small>}
        </div>
      </div>

      <div className="card stack" style={{ position: "sticky", top: 70 }}>
        <h2>Slot & giá</h2>
        {preview && b ? (
          <>
            <table className="data">
              <tbody>
                <tr>
                  <td>Chỗ chính thức</td>
                  <td>
                    <strong>{capacity}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Chỗ chờ ngoài cổng</td>
                  <td>
                    <strong>{preview.waitingCapacity}</strong> <small>= làm tròn xuống({capacity} × {Math.round(preview.waitingRatio * 100)}%)</small>
                  </td>
                </tr>
                <tr>
                  <td>Tổng slot hệ thống của phòng</td>
                  <td>
                    <strong>{preview.totalSlots}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Ngân sách hệ thống</td>
                  <td>
                    {b.budget} (đã cấp {b.allocated}, đang giữ cho thanh toán {b.held})
                  </td>
                </tr>
                <tr>
                  <td>Còn lại hiện tại</td>
                  <td>
                    <strong>{b.remaining}</strong> → sau khi tạo: <strong style={{ color: over ? "var(--danger)" : undefined }}>{b.remaining - preview.totalSlots}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="slotbar" aria-hidden>
              <span className="alloc" style={{ width: `${(b.allocated / Math.max(1, b.budget)) * 100}%` }} />
              <span className="held" style={{ width: `${(b.held / Math.max(1, b.budget)) * 100}%` }} />
              <span className="req" style={{ width: `${(Math.min(preview.totalSlots, b.remaining) / Math.max(1, b.budget)) * 100}%` }} />
            </div>
            <small>Phòng giữ toàn bộ slot kể cả khi chưa có ai, cho đến khi đóng/hết hạn.</small>
            {over && <p className="notice error">Không đủ slot hệ thống cho cấu hình này.</p>}

            <label className="field">
              Thời hạn
              <select
                value={openEnded && !useTrial ? "open" : hours}
                onChange={(e) => {
                  if (e.target.value === "open") setOpenEnded(true);
                  else {
                    setOpenEnded(false);
                    setHours(Number(e.target.value));
                  }
                }}
              >
                {durationChoices.map((h) => (
                  <option key={h} value={h}>
                    {h} giờ
                  </option>
                ))}
                {catalog.openEnded.enabled && !useTrial && <option value="open">Vô thời hạn — mở đến khi tắt phòng</option>}
              </select>
            </label>

            {openEnded && !useTrial && preview.quote?.openEnded && (
              <div className="notice stack" style={{ gap: 4 }}>
                <strong>Phòng mở vô thời hạn</strong>
                <span>
                  Đặt cọc trước <strong>{formatVnd(preview.quote.openEnded.deposit)}</strong>. Đơn giá <strong>{formatVnd(preview.quote.openEnded.hourlyRate)}/giờ</strong>
                  {preview.quote.openEnded.hourlyRate > 0 && ` — tiền cọc đủ cho khoảng ${Math.floor(preview.quote.openEnded.deposit / preview.quote.openEnded.hourlyRate)} giờ`}.
                </span>
                <small>
                  Khi bạn tắt phòng, hệ thống tính số giờ đã mở (giờ bắt đầu dở tính tròn 1 giờ) × đơn giá: còn dư thì hoàn lại cho bạn, thiếu thì thu thêm. Phòng giữ slot đến khi tắt.
                </small>
              </div>
            )}
            {preview.trial.eligible && !(openEnded && !useTrial) ? (
              <label className="check">
                <input type="checkbox" checked={useTrial} onChange={(e) => setUseTrial(e.target.checked)} /> Dùng thử miễn phí (tối đa {catalog.trial.maxCapacity} chỗ, {catalog.trial.maxHours} giờ)
              </label>
            ) : openEnded && !useTrial ? (
              <small>Dùng thử không áp dụng cho phòng vô thời hạn.</small>
            ) : (
              <small>Dùng thử: {preview.trial.reason}</small>
            )}

            {!useTrial &&
              (preview.quote ? (
                <div className="notice stack" style={{ gap: 6 }}>
                  {preview.quote.promo && (
                    <>
                      <div className="row between">
                        <span>Giá gốc</span>
                        <span style={{ textDecoration: "line-through" }}>{formatVnd(preview.quote.promo.amountBefore)}</span>
                      </div>
                      <div className="row between" style={{ color: "var(--ok)" }}>
                        <span>
                          Mã {preview.quote.promo.code} (−{preview.quote.promo.percentOff}%)
                        </span>
                        <span>−{formatVnd(preview.quote.promo.discount)}</span>
                      </div>
                    </>
                  )}
                  <div className="row between">
                    <span>{preview.quote.openEnded ? "Đặt cọc cần thanh toán" : preview.quote.promo ? "Cần thanh toán" : "Giá"}</span>
                    <strong>{formatVnd(preview.quote.amount)}</strong>
                  </div>
                  <small>{preview.quote.note}</small>
                  <div className="row">
                    <input type="text" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="Mã giảm giá" maxLength={32} style={{ flex: 1, minWidth: 120 }} aria-label="Mã giảm giá" />
                    <button type="button" className="btn small" onClick={() => setPromo(promoInput.trim())}>
                      Áp dụng
                    </button>
                    {promo && (
                      <button type="button" className="btn small" onClick={() => (setPromo(""), setPromoInput(""))}>
                        Bỏ mã
                      </button>
                    )}
                  </div>
                  {preview.promoError && <small style={{ color: "var(--danger)" }}>{preview.promoError}</small>}
                </div>
              ) : (
                <p className="notice warn">Chưa có giá cho cấu hình này (vượt bảng giá).</p>
              ))}
            <small>
              {openEnded && !useTrial ? "Thời gian tính tiền" : "Thời hạn"} tính từ lúc phòng được tạo thành công {useTrial ? "" : "(sau khi thanh toán được xác nhận)"}.
            </small>
          </>
        ) : (
          <p className="muted">Đang tính…</p>
        )}
        {err && <p className="notice error">{err}</p>}
        <button className="btn primary" disabled={busy || over || !groups.length || (!useTrial && !preview?.quote)}>
          {busy ? "Đang xử lý…" : useTrial ? "Tạo phòng dùng thử" : preview?.quote?.amount === 0 ? "Tạo phòng (miễn phí với mã)" : preview?.quote?.openEnded ? "Tạo đơn & đặt cọc" : "Tạo đơn & thanh toán"}
        </button>
      </div>
    </form>
  );
}

export default function NewRoomPage() {
  const { data } = useApi<Catalog>("/api/catalog");
  return (
    <AppShell requireLogin>
      {() => (
        <>
          <h1>Tạo phòng</h1>
          {data ? <CreateRoomForm catalog={data} /> : <p className="muted">Đang tải…</p>}
        </>
      )}
    </AppShell>
  );
}
