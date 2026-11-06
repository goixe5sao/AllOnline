import Link from "next/link";
import { formatVnd } from "@/core/pricing";
import type { HomePricing } from "@/lib/home-data";
import { JoinCode } from "./join-code";
import { Receptionist } from "./robot";

const SIGNUP = "/login?mode=signup&next=%2Frooms%2Fnew";

/** Feature brochures; `demo` = can be tried in the "Phòng trải nghiệm" right away. */
export const FEATURES: { icon: string; title: string; text: string; demo?: boolean }[] = [
  {
    icon: "🛸",
    title: "Một màn hình cho mọi người",
    text: "Chủ phòng chọn thứ cả phòng cùng xem trên màn hình sân khấu: video YouTube (lặp lại hoặc chiếu tiếp cả danh sách), biểu đồ chứng khoán Việt Nam cập nhật từng phút, hình ảnh, chữ, kết quả bình chọn. Ai vào lúc nào cũng thấy đúng đoạn đang chiếu, vì mọi thứ chạy theo giờ máy chủ.",
    demo: true,
  },
  {
    icon: "🎥",
    title: "Live camera lên sân khấu",
    text: "Chủ phòng (hoặc khán giả được chủ phòng duyệt) phát hình và tiếng từ camera, micro lên màn hình cho cả phòng — như MC trên sân khấu thật. Chủ phòng duyệt từng người xin lên sóng và cắt sóng bất cứ lúc nào; không ghi lại.",
    demo: true,
  },
  {
    icon: "🤖",
    title: "Nhân vật đại diện",
    text: "Mỗi người là một nhân vật 3D — người, động vật hay xe hơi (có xe theo mẫu VinFast, tự chọn màu). Ngồi ghế, quay nhìn quanh, hoặc xem từ phía sau 2 hàng để thấy cả mình lẫn sân khấu.",
    demo: true,
  },
  {
    icon: "👽",
    title: "Chat với người ngồi gần",
    text: "Tin nhắn chỉ đến người ở gần bạn, như thì thầm trong rạp, và không được lưu lại. Thêm thả cảm xúc bay lên sân khấu, giơ tay xin phát biểu, đặt câu hỏi cho chủ phòng.",
    demo: true,
  },
  {
    icon: "🗳️",
    title: "Bình chọn & Hỏi đáp trực tiếp",
    text: "Tạo bình chọn trong vài giây, kết quả nhảy ngay trên màn hình sân khấu. Khán giả đặt câu hỏi và bấm ▲ cho câu muốn nghe; chủ phòng đưa câu hay nhất lên màn hình.",
    demo: true,
  },
  {
    icon: "📱",
    title: "Mọi thiết bị, không cài đặt",
    text: "Chạy trên trình duyệt của máy tính, máy tính bảng và điện thoại. Khách chỉ cần link mời và một cái tên — không cần tài khoản. Máy yếu thì tự giảm đồ hoạ.",
  },
  {
    icon: "∞",
    title: "Theo giờ hoặc vô thời hạn",
    text: "Dùng thử miễn phí, mua gói theo giờ, hoặc mở phòng vô thời hạn: đặt cọc trước, tắt phòng khi xong, hệ thống tính đúng số giờ đã dùng và hoàn phần dư. Thanh toán bằng quét mã VietQR — tiền vào là phòng tự mở.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: "Khách có cần tạo tài khoản để vào phòng không?", a: "Không. Khách chỉ cần link mời (hoặc bấm vào phòng công khai trên màn hình sân khấu), nhập tên và chọn nhân vật. Tài khoản chỉ cần cho người tạo phòng." },
  { q: "Phòng của tôi có hiện trên trang chủ không?", a: "Tuỳ bạn. Khi tạo phòng có ô “Hiện phòng trên trang chủ”; bật/tắt lại bất cứ lúc nào trong Phòng của tôi hoặc bảng điều khiển phòng. Phòng ẩn chỉ vào được bằng link mời." },
  { q: "Phòng mở vô thời hạn tính tiền thế nào?", a: "Bạn đặt cọc trước (mặc định 1.000.000 ₫). Phòng mở đến khi bạn tắt. Khi tắt, hệ thống tính số giờ đã mở (giờ dở tính tròn 1 giờ) × đơn giá theo sức chứa: còn dư thì hoàn lại cho bạn, thiếu thì thu thêm." },
  { q: "Một phòng chứa được bao nhiêu người?", a: "Bạn chọn số chỗ chính thức khi tạo phòng; có thể bật thêm khu chờ ngoài cổng. Người chờ được mời vào theo thứ tự khi có chỗ trống." },
  { q: "Dùng được trên điện thoại không?", a: "Được. Sân Khấu Online chạy trên trình duyệt của máy tính, máy tính bảng và điện thoại; nút “Xem màn hình” mở riêng màn hình sân khấu toàn màn hình." },
];

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
                    {f.demo && (
                      <a className="f-try" href="#trai-nghiem">
                        Thử ngay trong phòng trải nghiệm →
                      </a>
                    )}
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
