"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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

/** Same limits as the server (core/screen.ts): checked here so the price box never waits on an error. */
const SYMBOL_RE = /^[A-Z0-9.]{1,12}$/;
const SCREEN_TEXT_MAX = 500;

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
  // What the user typed (may be empty while editing) and the number it means.
  const [capText, setCapText] = useState("20");
  const capacity = capText.trim() === "" ? NaN : Number(capText);
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
  // Why the last quote failed (shown instead of an endless "Đang tính…"); null = fine.
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  // Configuration the shown preview / error belongs to: anything else is still being priced.
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);
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
    if (screenKind === "text") return screenValue.trim() ? { kind: "text", text: screenValue.trim().slice(0, SCREEN_TEXT_MAX) } : undefined;
    if (screenKind === "youtube") {
      const id = parseYouTubeId(screenValue);
      return id ? { kind: "youtube", videoId: id } : undefined;
    }
    if (screenKind === "chart") {
      const symbol = (screenValue.trim() || "VNINDEX").toUpperCase();
      // same rule as the server; an invalid code is flagged next to the field, not sent
      return SYMBOL_RE.test(symbol) ? { kind: "chart", symbol, source: "demo", interval: chartInterval, indicators: ["volume", "ma20"] } : undefined;
    }
    return undefined;
  }, [screenKind, screenValue, chartInterval]);

  const symbolBad = screenKind === "chart" && !initialScreen;
  const config = { name: name.trim() || "Phòng mới", description, map, avatarGroups: groups, officialCapacity: capacity, waitingEnabled, entryMode, durationHours: hours, openEnded: openEnded && !useTrial, isPublic, password, initialScreen, scheduledAt: startsAt ? new Date(startsAt).getTime() : null, stageStyle };

  // Re-quote on ANY change of the configuration (a fixed mistake must clear the error), debounced;
  // a late answer to an older request is ignored.
  const quoteKey = JSON.stringify({ config, promo });
  const quoteSeq = useRef(0);
  // Input problems are known without asking the server.
  const inputErr = !Number.isInteger(capacity) || capacity < 1 ? "Hãy nhập số chỗ chính thức (số nguyên từ 1)." : !groups.length ? "Hãy chọn ít nhất một nhóm đối tượng đại diện." : null;
  useEffect(() => {
    if (inputErr) return;
    const seq = ++quoteSeq.current;
    const key = quoteKey;
    const id = setTimeout(() => {
      api<Preview>("/api/rooms/quote", { body: { ...config, promoCode: promo || undefined } })
        .then((p) => {
          if (seq !== quoteSeq.current) return;
          setPreview(p);
          setQuoteErr(null);
          setAnsweredKey(key);
        })
        .catch((e: ApiError) => {
          if (seq !== quoteSeq.current) return;
          setQuoteErr(e?.message || "Không tính được giá, thử lại sau.");
          setAnsweredKey(key);
        });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  /** Trial on: shorten the duration to what a trial allows; a too-large room is explained below. */
  const chooseTrial = (on: boolean) => {
    setUseTrial(on);
    if (on && hours > catalog.trial.maxHours) {
      const ok = catalog.durationOptions.filter((h) => h <= catalog.trial.maxHours);
      setHours(ok.length ? Math.max(...ok) : catalog.trial.maxHours);
    }
  };
  const tooBig = capacity > catalog.maxRoomCapacity;
  const trialTooBig = useTrial && capacity > catalog.trial.maxCapacity;

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
  const quoting = !inputErr && answeredKey !== quoteKey;
  const shownErr = inputErr ?? (quoting ? null : quoteErr);
  const blocked = !!shownErr || quoting || tooBig || trialTooBig || symbolBad;

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
          <input type="number" min={1} max={catalog.maxRoomCapacity} value={capText} onChange={(e) => setCapText(e.target.value)} required />
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
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Hiện phòng trên trang chủ Sân Khấu Online (ai cũng thấy và bấm vào được; đổi lại bất cứ lúc nào)
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
          {symbolBad && <small style={{ color: "var(--danger)" }}>Mã chứng khoán chỉ gồm chữ A–Z, số và dấu chấm, tối đa 12 ký tự (ví dụ VNINDEX, FPT).</small>}
          {screenKind === "text" && screenValue.trim().length > SCREEN_TEXT_MAX && <small>Chỉ hiện {SCREEN_TEXT_MAX} ký tự đầu.</small>}
        </div>
      </div>

      <div className="card stack" style={{ position: "sticky", top: 70 }}>
        <h2>
          Slot & giá {quoting && <small className="muted">· đang tính…</small>}
        </h2>
        {shownErr && (
          <p className="notice error" role="alert">
            {shownErr}
          </p>
        )}
        {tooBig && <p className="notice error">Tối đa {catalog.maxRoomCapacity} chỗ chính thức mỗi phòng.</p>}
        {trialTooBig && <p className="notice error">Dùng thử tối đa {catalog.trial.maxCapacity} chỗ chính thức — giảm số chỗ hoặc bỏ dùng thử.</p>}
        {preview && b ? (
          <>
            <table className="data">
              <tbody>
                <tr>
                  <td>Chỗ chính thức</td>
                  <td>
                    <strong>{Number.isFinite(capacity) ? capacity : "—"}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Chỗ chờ ngoài cổng</td>
                  <td>
                    <strong>{preview.waitingCapacity}</strong> <small>= làm tròn xuống({Number.isFinite(capacity) ? capacity : "—"} × {Math.round(preview.waitingRatio * 100)}%)</small>
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
                <input type="checkbox" checked={useTrial} onChange={(e) => chooseTrial(e.target.checked)} /> Dùng thử miễn phí (tối đa {catalog.trial.maxCapacity} chỗ, {catalog.trial.maxHours} giờ)
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
          !shownErr && <p className="muted">Đang tính…</p>
        )}
        {err && <p className="notice error">{err}</p>}
        <button className="btn primary" disabled={busy || blocked || over || !groups.length || (!useTrial && !preview?.quote)}>
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
