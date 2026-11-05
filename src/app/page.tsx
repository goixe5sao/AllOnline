import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Be_Vietnam_Pro, Exo_2 } from "next/font/google";
import { MAP_INFO, type MapCode } from "@/core/maps";
import { getHomeData } from "@/lib/home-data";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { Audience } from "@/components/home/audience";
import { Spotlight } from "@/components/home/spotlight";
import { HeroActions, HomeNav } from "@/components/home/home-nav";
import { JoinCode } from "@/components/home/join-code";
import { LiveRooms } from "@/components/home/live-rooms";
import { MyRooms } from "@/components/home/my-rooms";
import "./home.css";

const display = Exo_2({ subsets: ["latin", "vietnamese"], weight: ["600", "800"], variable: "--f-display", display: "swap" });
const body = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "700"], variable: "--f-body", display: "swap" });

export const metadata: Metadata = {
  title: { absolute: "AllOnline — Sân khấu 3D của tương lai | Phòng đang mở" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const STAGES: Record<MapCode, { fit: string; tag: string }> = {
  hall: { tag: "Hội nghị · lớp học · ra mắt", fit: "Ghế dốc như rạp thật, lối đi giữa, cổng và khu chờ. Hợp cho hội thảo, lớp học, họp cổ đông, ra mắt sản phẩm." },
  carpet: { tag: "Thiền · trò chuyện · cộng đồng", fit: "Thảm ngồi so le quanh màn hình chung — gần gũi, thư thái. Hợp cho buổi thiền, chia sẻ, câu lạc bộ." },
  tables: { tag: "Workshop · nhóm · networking", fit: "Mỗi bàn 4 chỗ, chat với người cùng bàn. Hợp cho workshop, thảo luận nhóm, kết nối." },
  drive_in: { tag: "Chiếu phim · đêm nhạc · sự kiện lớn", fit: "Rạp ngoài trời buổi tối, ô đỗ dốc dần và so le để xe trước không che. Khách lái xe vào chỗ và xem từ ghế lái." },
};

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🛸", title: "Một màn hình cho mọi người", text: "Video YouTube, biểu đồ chứng khoán Việt Nam cập nhật từng phút, hình ảnh, văn bản, bình chọn — mọi người thấy cùng lúc, đồng bộ theo giờ máy chủ." },
  { icon: "🤖", title: "Nhân vật đại diện", text: "Người, động vật hay xe. Ngồi ghế, quay nhìn quanh, xem từ phía sau 2 hàng để thấy chính mình giữa khán phòng." },
  { icon: "👽", title: "Chat với người ngồi gần", text: "Tin nhắn chỉ tới những ai ở gần bạn, như thì thầm trong khán phòng thật. Không lưu lại, không voice, không webcam." },
  { icon: "🗳️", title: "Bình chọn trực tiếp", text: "Chủ phòng mở câu hỏi, kết quả hiện ngay trên sân khấu. Có thể chỉ cho tài khoản đã đăng ký bình chọn để chống gian lận." },
  { icon: "📱", title: "Máy tính, máy tính bảng, điện thoại", text: "Chạy ngay trên trình duyệt, không cài đặt. Điện thoại có cần điều khiển cảm ứng; máy yếu bật đồ hoạ nhẹ." },
  { icon: "∞", title: "Theo giờ hoặc vô thời hạn", text: "Dùng thử miễn phí, gói 6–24 giờ, hoặc mở vô thời hạn: đặt cọc trước, tắt phòng mới tính đúng số giờ đã dùng." },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Khách có cần tạo tài khoản để vào phòng không?", a: "Không. Khách chỉ cần link mời (hoặc bấm vào phòng công khai trên trang chủ), nhập tên và chọn nhân vật. Tài khoản chỉ cần cho người tạo phòng." },
  { q: "Phòng của tôi có hiện trên trang chủ không?", a: "Tuỳ bạn. Khi tạo phòng có ô “Hiện phòng trên trang chủ”; bạn bật/tắt lại bất cứ lúc nào trong mục Phòng của tôi hoặc bảng điều khiển phòng. Phòng ẩn chỉ vào được bằng link mời." },
  { q: "Phòng mở vô thời hạn tính tiền thế nào?", a: "Bạn đặt cọc trước (mặc định 1.000.000 ₫). Phòng mở đến khi bạn tắt. Khi tắt, hệ thống tính số giờ đã mở (giờ dở tính tròn 1 giờ) × đơn giá theo sức chứa: còn dư thì hoàn lại cho bạn, thiếu thì thu thêm." },
  { q: "Một phòng chứa được bao nhiêu người?", a: "Bạn chọn số chỗ chính thức khi tạo phòng; có thể bật thêm khu chờ ngoài cổng. Người chờ được mời vào theo thứ tự khi có chỗ trống." },
  { q: "Dùng được trên điện thoại không?", a: "Được. AllOnline chạy trên trình duyệt của máy tính, máy tính bảng và điện thoại; nút “Xem màn hình” mở riêng màn hình sân khấu toàn màn hình." },
];

function JsonLd({ rooms }: { rooms: { name: string; inviteCode: string }[] }) {
  const data = [
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL, inLanguage: "vi-VN", description: SITE_DESCRIPTION },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "AllOnline",
      url: SITE_URL,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web (Windows, macOS, Android, iOS)",
      inLanguage: "vi-VN",
      offers: { "@type": "Offer", price: "0", priceCurrency: "VND", description: "Dùng thử miễn phí" },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ...(rooms.length
      ? [{ "@context": "https://schema.org", "@type": "ItemList", name: "Phòng đang mở", itemListElement: rooms.slice(0, 20).map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.name, url: `${SITE_URL}/join/${r.inviteCode}` })) }]
      : []),
  ];
  // JSON.stringify output is safe in a script tag once "<" is escaped.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export default async function Home() {
  await connection(); // live data: render per request
  const { rooms, enabledMaps, online } = await getHomeData();
  const watching = rooms.reduce((n, r) => n + (r.live?.admitted ?? 0), 0);

  return (
    <div className={`home ${display.variable} ${body.variable}`}>
      <JsonLd rooms={rooms} />
      <div className="stars" aria-hidden />
      <HomeNav />

      <main>
        {/* The whole first screen is a theater: curtains, beams, the stage screen (with the
            introduction inside it) and rows of seats; the rest of the page sits below the seats. */}
        <section className="theater" aria-labelledby="hero-h">
          <Spotlight target=".theater" />
          <div className="th-valance" aria-hidden />
          <div className="th-curtain l" aria-hidden />
          <div className="th-curtain r" aria-hidden />
          <div className="th-beams" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="th-follow" aria-hidden />

          <div className="th-screen-wrap">
            <div className="th-screen">
              <div className="th-screen-fx" aria-hidden />
              <div className="th-badges" aria-hidden>
                <span className="live">● LIVE</span>
                <span>SÂN KHẤU CHÍNH · ALLONLINE</span>
              </div>
              <div className="th-content">
                <p className="eyebrow">Sân khấu của thời đại mới</p>
                <h1 id="hero-h">
                  Người, robot, người ngoài hành tinh và AI
                  <span className="grad"> cùng chung một sân khấu.</span>
                </h1>
                <p className="lead">
                  Khán phòng 3D trực tuyến: mở phòng trong một phút, mời mọi người bằng một đường link, cùng xem màn hình sân khấu, trò chuyện với người ngồi cạnh và bình chọn trực tiếp — ngay trên trình duyệt.
                </p>
                <div className="th-cta">
                  <HeroActions />
                  <JoinCode />
                </div>
              </div>
            </div>
            <div className="th-reflect" aria-hidden />
          </div>
          {/* LED band on the stage lip */}
          <div className="th-stage">
            <dl className="led">
              <div>
                <dt>phòng công khai đang mở</dt>
                <dd>{rooms.length}</dd>
              </div>
              <div>
                <dt>khán giả đang trong phòng</dt>
                <dd>{Math.max(online, watching)}</dd>
              </div>
              <div>
                <dt>kiểu sân khấu</dt>
                <dd>{enabledMaps.length}</dd>
              </div>
            </dl>
          </div>
          <div className="th-audience">
            <Audience />
          </div>
          <a className="th-cue" href="#phong-dang-mo">
            <span>Mời xuống hàng ghế</span>
            <span aria-hidden>↓</span>
          </a>
        </section>

        <div className="floor">
        <section id="phong-dang-mo" className="hs-section" aria-labelledby="rooms-h">
          <div className="sec-head">
            <div>
              <p className="row-sign">
                <b>Hàng A</b> Đang diễn ra
              </p>
              <h2 id="rooms-h">Phòng đang mở</h2>
            </div>
            <p className="sec-note">Chủ phòng tự chọn hiện phòng ở đây. Bấm vào một phòng để ghé xem — không cần tài khoản.</p>
          </div>
          <LiveRooms initial={rooms} maps={enabledMaps} />
        </section>

        <MyRooms />

        <section id="kieu-san-khau" className="hs-section" aria-labelledby="stages-h">
          <div className="sec-head">
            <div>
              <p className="row-sign">
                <b>Hàng B</b> Tham khảo
              </p>
              <h2 id="stages-h">Các kiểu sân khấu trên AllOnline</h2>
            </div>
            <p className="sec-note">Ảnh chụp từ khán phòng thật trong ứng dụng. Chọn kiểu phù hợp khi tạo phòng.</p>
          </div>
          <div className="stage-grid">
            {(Object.keys(MAP_INFO) as MapCode[]).map((m) => (
              <article className={`stage-card ${enabledMaps.includes(m) ? "" : "off"}`} key={m}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static webp preview */}
                <img src={`/maps/${m}.webp`} alt={`Ảnh ${MAP_INFO[m].name} trong AllOnline`} loading="lazy" width={960} height={600} />
                <div className="stage-body">
                  <p className="stage-tag">{STAGES[m].tag}</p>
                  <h3>{MAP_INFO[m].name}</h3>
                  <p>{STAGES[m].fit}</p>
                  {!enabledMaps.includes(m) && <p className="stage-off">Tạm chưa mở</p>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="cach-hoat-dong" className="hs-section" aria-labelledby="how-h">
          <div className="sec-head">
            <div>
              <p className="row-sign">
                <b>Hàng C</b> 3 bước
              </p>
              <h2 id="how-h">Mở sân khấu của riêng bạn</h2>
            </div>
          </div>
          <ol className="steps">
            <li>
              <b>Tạo tài khoản</b>
              <span>Email và mật khẩu, mất chưa đến một phút.</span>
            </li>
            <li>
              <b>Mở phòng</b>
              <span>Chọn kiểu sân khấu, số chỗ, thời lượng — hoặc vô thời hạn đến khi bạn tắt. Có dùng thử miễn phí.</span>
            </li>
            <li>
              <b>Gửi link mời</b>
              <span>Khách vào ngay, không cần tài khoản. Bạn điều khiển màn hình, bình chọn và người tham dự.</span>
            </li>
          </ol>
          <div className="features">
            {FEATURES.map((f) => (
              <article className="feature" key={f.title}>
                <span className="f-icon" aria-hidden>
                  {f.icon}
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="cta-band" aria-labelledby="cta-h">
          <h2 id="cta-h">Sân khấu tương lai đang chờ bạn bước lên.</h2>
          <p>Tạo tài khoản miễn phí, mở phòng đầu tiên và mời cả vũ trụ của bạn vào xem.</p>
          <div className="hero-actions center">
            <Link className="btn-neon" href="/login?mode=signup&next=%2Frooms%2Fnew">
              Tạo tài khoản miễn phí
            </Link>
            <Link className="btn-ghost" href="/login?next=%2Frooms%2Fnew">
              Tôi đã có tài khoản
            </Link>
          </div>
        </section>

        <section id="hoi-dap" className="hs-section" aria-labelledby="faq-h">
          <div className="sec-head">
            <div>
              <p className="row-sign">
                <b>Hàng D</b> Hỏi đáp
              </p>
              <h2 id="faq-h">Câu hỏi thường gặp</h2>
            </div>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
        </div>
      </main>

      <footer className="foot">
        <span>
          © {new Date().getFullYear()} AllOnline · <a href={SITE_URL}>{SITE_URL.replace(/^https?:\/\//, "")}</a>
        </span>
        <nav aria-label="Liên kết cuối trang">
          <a href="#phong-dang-mo">Phòng đang mở</a>
          <a href="#kieu-san-khau">Kiểu sân khấu</a>
          <Link href="/login">Đăng nhập</Link>
        </nav>
      </footer>
    </div>
  );
}
