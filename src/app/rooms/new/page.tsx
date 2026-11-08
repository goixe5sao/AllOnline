"use client";

import { Button, PageHeader, RadioCard, Stepper, StickyActionBar } from "@/components/ui";
import { Armchair, Car, LayoutGrid, Presentation, Table, Sparkles, Square } from "lucide-react";
import "./rooms-new.css";
import { SymbolPicker } from "@/components/room/symbol-picker";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { api, ApiError, useApi } from "@/lib/api";
import { AVATARS, MAP_INFO, type AvatarGroup, type MapCode } from "@/core/maps";
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

const mapIcons = { hall: Armchair, carpet: LayoutGrid, tables: Table, drive_in: Car, meeting: Presentation };

function CreateRoomForm({ catalog, isAdmin }: { catalog: Catalog; isAdmin: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    const actions = form?.querySelector(".room-actions");
    if (!form || !actions) return;
    const observer = new ResizeObserver(([entry]) => form.style.setProperty("--room-action-height", `${entry.target.getBoundingClientRect().height}px`));
    observer.observe(actions);
    return () => observer.disconnect();
  }, []);
  const steps = ["Phòng & sân khấu", "Thời gian & quy mô", "Tiện ích", "Xem lại & thanh toán"];
  function nextStep() {
    const controls = formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-step="${step}"] input, [data-step="${step}"] select`);
    for (const control of controls ?? []) if (!control.reportValidity()) return;
    setStep(s => Math.min(3, s + 1));
  }
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
  const config = { name: name.trim() || "Phòng mới", description, map, avatarGroups: groups, officialCapacity: capacity, waitingEnabled, entryMode, durationHours: hours, openEnded: openEnded && !useTrial, isPublic, password, initialScreen, scheduledAt: startsAt ? new Date(startsAt).getTime() : null, stageStyle: MAP_INFO[map].furnished ? "plain" : stageStyle };

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
    if (step < 3) { nextStep(); return; }
    if (!name) { setStep(0); return; }
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
    <form className="room-flow" ref={formRef} noValidate onSubmit={submit}>
      <div className="room-progress"><Stepper steps={steps} current={step} /></div>
      <div className="room-layout">
      <div className="ui-card room-fields">
      <section data-step="0" hidden={step !== 0} className="stack"><h2>{steps[0]}</h2>
        <label className="field">
          Tên phòng
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label className="field">
          Mô tả
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
        </label>
        <div className="field">
          <strong>Không gian</strong>
          <div className="choice-grid">
            {catalog.maps.map((m) => { const Icon = mapIcons[m.code]; return (
              <RadioCard key={m.code} name="map" value={m.code} checked={map === m.code} disabled={!m.enabled} onChange={() => chooseMap(m.code)}><Icon aria-hidden />
                <strong>{m.name}</strong>
                <br />
                <small>{m.description}</small>
              </RadioCard>
            ); })}
          </div>
        </div>
        <div className="field">
          <strong>Nhân vật (avatar) được dùng</strong>
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
        {MAP_INFO[map].furnished ? (
          <small>{MAP_INFO[map].name} có nội thất riêng (không chọn kiểu sân khấu); trong phòng vẫn bật / tắt đèn được.</small>
        ) : (
        <div className="field">
          Kiểu sân khấu <small>(đổi được bất cứ lúc nào trong phòng)</small>
          <fieldset className="ui-radio-group"><legend>Chọn kiểu sân khấu</legend><div className="choice-grid">
            {(
              [
                ["glam", "Hành tinh tương lai", "Rèm đèn LED, vòm hologram, đèn quét, bầu trời hành tinh & cực quang — bật/tắt đèn trong phòng"],
                ["plain", "Đơn sắc", "Hội trường sáng, gọn, nhẹ máy"],
              ] as const
            ).map(([v, t, d]) => (
              <RadioCard key={v} name="stageStyle" value={v} checked={stageStyle === v} onChange={() => setStageStyle(v)}>{v === "glam" ? <Sparkles aria-hidden /> : <Square aria-hidden />}
                <strong>{t}</strong>
                <br />
                <small>{d}</small>
              </RadioCard>
            ))}
          </div></fieldset>
        </div>
        )}

      </section>
      <section data-step="1" hidden={step !== 1} className="stack"><h2>{steps[1]}</h2>
        <label className="field">
          Số chỗ chính thức
          <input type="number" min={1} max={catalog.maxRoomCapacity} value={capText} onChange={(e) => setCapText(e.target.value)} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={waitingEnabled} onChange={(e) => setWaitingEnabled(e.target.checked)} /> Cho người chờ ngoài cổng (tỷ lệ {Math.round(catalog.waitingRatio * 100)}%)
        </label>
        <label className="field">
          Giờ bắt đầu sự kiện <small>(không bắt buộc — trang mời hiện đếm ngược, khách bấm “Nhắc tôi” để bot Zalo nhắc)</small>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
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

            {preview?.trial.eligible && !(openEnded && !useTrial) ? (
              <label className="check">
                <input type="checkbox" checked={useTrial} onChange={(e) => chooseTrial(e.target.checked)} /> Dùng thử miễn phí (tối đa {catalog.trial.maxCapacity} chỗ, {catalog.trial.maxHours} giờ)
              </label>
            ) : openEnded && !useTrial ? (
              <small>Dùng thử không áp dụng cho phòng vô thời hạn.</small>
            ) : (
              <small>Dùng thử: {preview?.trial.reason}</small>
            )}


      </section>
      <section data-step="2" hidden={step !== 2} className="stack"><h2>{steps[2]}</h2>
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
        <label className="field">
          Mật mã phòng <small>(không bắt buộc)</small>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="off" />
        </label>
        <div className="field">
          <strong>Nội dung màn hình ban đầu</strong>
          <div className="row">
            <select aria-label="Loại nội dung màn hình" value={screenKind} onChange={(e) => {
                const k = e.target.value as typeof screenKind;
                // each kind keeps its own value: a welcome text is not a stock code
                setScreenValue(k === "text" ? "Chào mừng đến với phòng!" : k === "chart" ? "VNINDEX" : "");
                setScreenKind(k);
              }} style={{ width: "auto" }}>
              <option value="text">Văn bản</option>
              <option value="youtube">Video YouTube</option>
              <option value="chart">Biểu đồ chứng khoán (dữ liệu thật mỗi phút)</option>
              <option value="blank">Để trống</option>
            </select>
            {screenKind !== "blank" && screenKind !== "chart" && (
              <input
                type="text"
                value={screenValue}
                onChange={(e) => setScreenValue(e.target.value)}
                placeholder={screenKind === "youtube" ? "Link YouTube" : "Nội dung"}
                aria-label={screenKind === "youtube" ? "Link YouTube" : "Nội dung màn hình"}
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
          {/* same stock list as the in-room control panel: search by code or company name */}
          {screenKind === "chart" && <SymbolPicker value={screenValue} onChange={setScreenValue} />}
          {screenKind === "youtube" && screenValue && !initialScreen && <small style={{ color: "var(--danger)" }}>Link YouTube không hợp lệ.</small>}
          {symbolBad && <small style={{ color: "var(--danger)" }}>Mã chứng khoán chỉ gồm chữ A–Z, số và dấu chấm, tối đa 12 ký tự (ví dụ VNINDEX, FPT).</small>}
          {screenKind === "text" && screenValue.trim().length > SCREEN_TEXT_MAX && <small>Chỉ hiện {SCREEN_TEXT_MAX} ký tự đầu.</small>}
        </div>

      </section>
      <section data-step="3" hidden={step !== 3} className="stack"><h2>{steps[3]}</h2>
<h3>{name || "Phòng mới"}</h3><p>{description || "Chưa có mô tả"}</p>
        <dl className="room-review">
          <dt>Không gian</dt><dd>{mapInfo.name} · {MAP_INFO[map].furnished ? "Nội thất riêng" : stageStyle === "glam" ? "Hành tinh tương lai" : "Đơn sắc"}</dd>
          <dt>Nhân vật</dt><dd>{groups.map(g => AVATARS[g].label).join(", ")}</dd>
          <dt>Quy mô</dt><dd>{capText} chỗ · {waitingEnabled ? "Có chỗ chờ" : "Không chỗ chờ"}</dd>
          <dt>Thời hạn</dt><dd>{openEnded && !useTrial ? "Vô thời hạn" : `${hours} giờ`}</dd>
          <dt>Sự kiện</dt><dd>{startsAt || "Sau khi tạo phòng"}</dd>
          <dt>Truy cập</dt><dd>{isPublic ? "Công khai" : "Riêng tư"} · {password ? "Có mật mã" : "Không mật mã"}</dd>
          <dt>Vào phòng</dt><dd>{entryMode === "gate_entry" ? "Vào từ cổng" : "Tự xếp chỗ"}</dd>
          <dt>Màn hình</dt><dd>{screenKind === "blank" ? "Để trống" : screenValue}{screenKind === "chart" && ` · ${INTERVAL_LABEL[chartInterval]}`}</dd>
        </dl><p className="muted">Kiểm tra cấu hình và giá trước khi tạo phòng. Quay lại để chỉnh sửa.</p>
      </section>
      </div>
      <aside className={`card stack room-summary ${summaryOpen ? "is-open" : ""}`} id="room-summary">
        <h2>
          Tóm tắt & giá {quoting && <small className="muted">· đang tính…</small>}
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
            <table className="data"><tbody>
              <tr><td>Chỗ chính thức</td><td><strong>{Number.isFinite(capacity) ? capacity : "—"}</strong></td></tr>
              <tr><td>Chỗ chờ</td><td><strong>{preview.waitingCapacity}</strong></td></tr>
              <tr><td>Thời hạn</td><td>{openEnded && !useTrial ? "Vô thời hạn" : `${hours} giờ`}</td></tr>
              <tr><td>Giá</td><td>{formatVnd(useTrial ? 0 : preview.quote?.promo?.amountBefore ?? preview.quote?.amount ?? 0)}</td></tr>
              {preview.quote?.promo && !useTrial && <tr><td>Mã {preview.quote.promo.code} (−{preview.quote.promo.percentOff}%)</td><td>−{formatVnd(preview.quote.promo.discount)}</td></tr>}
              <tr><td>Tổng</td><td><strong>{useTrial ? formatVnd(0) : preview.quote ? formatVnd(preview.quote.amount) : "Chưa có giá"}</strong></td></tr>
            </tbody></table>
            {isAdmin && <details className="room-system"><summary>Chi tiết hệ thống</summary><div className="stack">
              <p>Tổng slot hệ thống của phòng: {preview.totalSlots}</p>
              <p>Ngân sách hệ thống: {b.budget} (đã cấp {b.allocated}, đang giữ cho thanh toán {b.held})</p>
              <p>Còn lại hiện tại: {b.remaining} → sau khi tạo: {b.remaining - preview.totalSlots}</p>
              <small>Chỗ chờ = làm tròn xuống({Number.isFinite(capacity) ? capacity : "—"} × {Math.round(preview.waitingRatio * 100)}%)</small>
              <div className="slotbar" aria-hidden>
                <span className="alloc" style={{ width: `${b.allocated / Math.max(1, b.budget) * 100}%` }} />
                <span className="held" style={{ width: `${b.held / Math.max(1, b.budget) * 100}%` }} />
                <span className="req" style={{ width: `${Math.min(preview.totalSlots, b.remaining) / Math.max(1, b.budget) * 100}%` }} />
              </div>
              <small>Phòng giữ toàn bộ slot kể cả khi chưa có ai, cho đến khi đóng/hết hạn.</small>
            </div></details>}
            {over && <p className="notice error">Hệ thống đang hết chỗ cho cấu hình này, hãy giảm số chỗ hoặc thử lại sau</p>}

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
            {!useTrial &&
              (preview.quote ? (
                <div className="notice stack" style={{ gap: 6 }}>
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
      </aside>
      </div>
      <StickyActionBar className="room-actions">
        <button type="button" className="room-total" aria-expanded={summaryOpen} aria-controls="room-summary" onClick={() => setSummaryOpen(!summaryOpen)}>
          <small>Tổng thanh toán <span className="room-summary-toggle">{summaryOpen ? "Thu gọn" : "Chi tiết"}</span></small>
          <strong>{quoting ? "Đang tính…" : useTrial ? formatVnd(0) : preview?.quote ? formatVnd(preview.quote.amount) : "Chưa có giá"}</strong>
        </button>
        <div className="room-cta">
          {(over || err || shownErr || tooBig || trialTooBig || symbolBad) && <p className="ui-error" role="alert">{err || shownErr || (over ? "Hệ thống đang hết chỗ cho cấu hình này, hãy giảm số chỗ hoặc thử lại sau" : tooBig ? `Tối đa ${catalog.maxRoomCapacity} chỗ chính thức mỗi phòng.` : trialTooBig ? `Dùng thử tối đa ${catalog.trial.maxCapacity} chỗ chính thức.` : "Kiểm tra mã chứng khoán.")}</p>}
          <div className="room-action-buttons">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
          {step < 3 && <Button variant="primary" onClick={nextStep}>Tiếp tục</Button>}
        <button hidden={step !== 3} type="submit" className="btn primary ui-button ui-button-primary" disabled={busy || blocked || over || !groups.length || (!useTrial && !preview?.quote)}>
          {busy ? "Đang xử lý…" : useTrial ? "Tạo phòng dùng thử" : preview?.quote?.amount === 0 ? "Tạo phòng (miễn phí với mã)" : preview?.quote?.openEnded ? "Tạo đơn & đặt cọc" : "Tạo đơn & thanh toán"}
        </button>
          </div>
        </div>
      </StickyActionBar>
    </form>
  );
}

export default function NewRoomPage() {
  const { data } = useApi<Catalog>("/api/catalog");
  return (
    <AppShell requireLogin>
      {(me) => (
        <>
          <PageHeader title="Tạo phòng" subtitle="Thiết kế không gian cho sự kiện của bạn." />
          {data ? <CreateRoomForm catalog={data} isAdmin={me.role === "app_owner"} /> : <p className="muted">Đang tải…</p>}
        </>
      )}
    </AppShell>
  );
}
