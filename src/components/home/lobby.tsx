import Link from "next/link";
import { formatVnd } from "@/core/pricing";
import type { HomePricing } from "@/lib/home-data";
import { JoinCode } from "./join-code";

const SIGNUP = "/login?mode=signup&next=%2Frooms%2Fnew";

export const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🛸", title: "Một màn hình cho mọi người", text: "YouTube, biểu đồ chứng khoán VN từng phút, hình ảnh, văn bản — đồng bộ theo giờ máy chủ." },
  { icon: "🤖", title: "Nhân vật đại diện", text: "Người, động vật hay xe; ngồi ghế, quay nhìn quanh, xem từ phía sau 2 hàng." },
  { icon: "👽", title: "Chat với người ngồi gần", text: "Chỉ người ở gần nhận được, như thì thầm trong rạp. Không lưu, không voice/webcam." },
  { icon: "🗳️", title: "Bình chọn trực tiếp", text: "Kết quả hiện ngay trên sân khấu; có thể chỉ cho tài khoản đã đăng ký." },
  { icon: "📱", title: "Mọi thiết bị", text: "Máy tính, máy tính bảng, điện thoại — chạy trên trình duyệt, không cài đặt." },
  { icon: "∞", title: "Theo giờ hoặc vô thời hạn", text: "Dùng thử, gói giờ, hoặc mở đến khi tắt: cọc trước, tính đúng giờ đã dùng." },
];

export const FAQ: { q: string; a: string }[] = [
  { q: "Khách có cần tạo tài khoản để vào phòng không?", a: "Không. Khách chỉ cần link mời (hoặc bấm vào phòng công khai trên màn hình sân khấu), nhập tên và chọn nhân vật. Tài khoản chỉ cần cho người tạo phòng." },
  { q: "Phòng của tôi có hiện trên trang chủ không?", a: "Tuỳ bạn. Khi tạo phòng có ô “Hiện phòng trên trang chủ”; bật/tắt lại bất cứ lúc nào trong Phòng của tôi hoặc bảng điều khiển phòng. Phòng ẩn chỉ vào được bằng link mời." },
  { q: "Phòng mở vô thời hạn tính tiền thế nào?", a: "Bạn đặt cọc trước (mặc định 1.000.000 ₫). Phòng mở đến khi bạn tắt. Khi tắt, hệ thống tính số giờ đã mở (giờ dở tính tròn 1 giờ) × đơn giá theo sức chứa: còn dư thì hoàn lại cho bạn, thiếu thì thu thêm." },
  { q: "Một phòng chứa được bao nhiêu người?", a: "Bạn chọn số chỗ chính thức khi tạo phòng; có thể bật thêm khu chờ ngoài cổng. Người chờ được mời vào theo thứ tự khi có chỗ trống." },
  { q: "Dùng được trên điện thoại không?", a: "Được. AllOnline chạy trên trình duyệt của máy tính, máy tính bảng và điện thoại; nút “Xem màn hình” mở riêng màn hình sân khấu toàn màn hình." },
];

/** Friendly robot behind the reception desk (original SVG). */
function Receptionist() {
  return (
    <svg className="rcp" viewBox="0 0 160 150" aria-hidden focusable="false">
      <defs>
        <linearGradient id="rcp-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3570" />
          <stop offset="1" stopColor="#141a3a" />
        </linearGradient>
      </defs>
      <line x1="80" y1="18" x2="80" y2="4" stroke="#3df5ff" strokeWidth="3" />
      <circle className="au-blink" cx="80" cy="4" r="4" fill="#ff4fd8" />
      <rect x="44" y="18" width="72" height="56" rx="18" fill="url(#rcp-body)" stroke="#3df5ff" strokeWidth="2.5" />
      <rect x="54" y="32" width="52" height="26" rx="13" fill="#05060f" />
      <g className="rcp-eyes">
        <circle cx="70" cy="45" r="5" fill="#3df5ff" />
        <circle cx="90" cy="45" r="5" fill="#3df5ff" />
      </g>
      <path d="M70 64 Q80 70 90 64" stroke="#b6ff3d" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="40" y="80" width="80" height="70" rx="20" fill="url(#rcp-body)" stroke="#8b5cff" strokeWidth="2" />
      <circle cx="80" cy="104" r="9" fill="none" stroke="#ffd38a" strokeWidth="2.5" />
      <path className="rcp-wave" d="M120 96 Q146 84 150 60" stroke="#3df5ff" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M40 100 Q24 112 30 130" stroke="#3df5ff" strokeWidth="9" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The lobby below the seats: ticket booth, reception desk and information desk. */
export function Lobby({ pricing }: { pricing: HomePricing | null }) {
  const p = pricing;
  const hours = p?.durations.length ? `${Math.min(...p.durations)}–${Math.max(...p.durations)} giờ` : "theo giờ";
  return (
    <section className="lobby" aria-labelledby="lobby-h">
      <div className="lobby-head">
        <p className="eyebrow">Sảnh khán phòng</p>
        <h2 id="lobby-h">Mời ghé quầy</h2>
      </div>

      <div className="desks">
        {/* ---- ticket booth ---- */}
        <article id="quay-ve" className="desk desk-tickets" aria-labelledby="quay-ve-h">
          <div className="desk-sign">
            <span id="quay-ve-h">QUẦY BÁN VÉ</span>
          </div>
          <div className="desk-window">
            <p className="desk-intro">Chọn vé để mở sân khấu của riêng bạn. Khách của bạn vào xem miễn phí, không cần tài khoản.</p>
            <div className="tickets">
              {(!p || p.trial.enabled) && (
                <div className="tk tk-trial">
                  <span className="tk-kind">Vé dùng thử</span>
                  <span className="tk-price">Miễn phí</span>
                  <span className="tk-terms">{p ? `Tối đa ${p.trial.maxCapacity} chỗ · ${p.trial.maxHours} giờ` : "Giới hạn chỗ và giờ"}</span>
                  <Link className="tk-btn" href={SIGNUP}>
                    Lấy vé
                  </Link>
                </div>
              )}
              <div className="tk tk-hour">
                <span className="tk-kind">Vé theo giờ</span>
                <span className="tk-price">{p?.from ? `từ ${formatVnd(p.from.price)}` : "Theo bảng giá"}</span>
                <span className="tk-terms">Gói {hours} · theo sức chứa</span>
                <Link className="tk-btn" href={SIGNUP}>
                  Mua vé
                </Link>
              </div>
              {(!p || p.openEnded.enabled) && (
                <div className="tk tk-inf">
                  <span className="tk-kind">Vé vô thời hạn</span>
                  <span className="tk-price">{p ? `cọc ${formatVnd(p.openEnded.deposit)}` : "Đặt cọc"}</span>
                  <span className="tk-terms">{p?.openEnded.hourlyFrom ? `từ ${formatVnd(p.openEnded.hourlyFrom)}/giờ · ` : ""}mở đến khi tắt, dư hoàn lại</span>
                  <Link className="tk-btn" href={SIGNUP}>
                    Đặt cọc
                  </Link>
                </div>
              )}
            </div>
          </div>
          <div className="desk-counter" aria-hidden />
        </article>

        {/* ---- reception ---- */}
        <article id="tiep-tan" className="desk desk-reception" aria-labelledby="tiep-tan-h">
          <div className="desk-sign">
            <span id="tiep-tan-h">TIẾP TÂN</span>
          </div>
          <div className="desk-window">
            <div className="greet">
              <Receptionist />
              <p className="greet-bubble">Xin chào! Có mã mời thì đưa tôi xem, tôi dẫn bạn vào phòng ngay.</p>
            </div>
            <JoinCode />
            <ol className="steps-mini" aria-label="Mở sân khấu của riêng bạn">
              <li>
                <b>Tạo tài khoản</b> — email và mật khẩu, chưa đến một phút.
              </li>
              <li>
                <b>Mở phòng</b> — chọn kiểu sân khấu, số chỗ, thời lượng.
              </li>
              <li>
                <b>Gửi link mời</b> — khách vào ngay, bạn điều khiển màn hình.
              </li>
            </ol>
          </div>
          <div className="desk-counter" aria-hidden />
        </article>

        {/* ---- information ---- */}
        <article id="hoi-dap" className="desk desk-info" aria-labelledby="hoi-dap-h">
          <div className="desk-sign">
            <span id="hoi-dap-h">QUẦY THÔNG TIN</span>
          </div>
          <div className="desk-window info-grid">
            <div className="brochures" aria-label="Tính năng">
              {FEATURES.map((f) => (
                <div className="brochure" key={f.title}>
                  <span className="f-icon" aria-hidden>
                    {f.icon}
                  </span>
                  <div>
                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="faq">
              <h3 className="faq-title">Câu hỏi thường gặp</h3>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
          <div className="desk-counter" aria-hidden />
        </article>
      </div>
    </section>
  );
}
