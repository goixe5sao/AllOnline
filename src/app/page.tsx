import type { Metadata } from "next";
import { connection } from "next/server";
import { Be_Vietnam_Pro, Exo_2 } from "next/font/google";
import { getHomeData } from "@/lib/home-data";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { Audience } from "@/components/home/audience";
import { HeroActions, HomeNav } from "@/components/home/home-nav";
import { JoinCode } from "@/components/home/join-code";
import { LightSwitch } from "@/components/home/light-switch";
import { FAQ, Lobby } from "@/components/home/lobby";
import { MyRooms } from "@/components/home/my-rooms";
import { DemoRooms } from "@/components/home/demo-rooms";
import { Spotlight } from "@/components/home/spotlight";
import { StageSlides } from "@/components/home/stage-slides";
import "./home.css";

const display = Exo_2({ subsets: ["latin", "vietnamese"], weight: ["600", "800"], variable: "--f-display", display: "swap" });
const body = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "700"], variable: "--f-body", display: "swap" });

export const metadata: Metadata = {
  title: { absolute: "Sân Khấu Online — Sân khấu 3D của tương lai | Phòng đang mở" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

function JsonLd({ rooms }: { rooms: { name: string; inviteCode: string }[] }) {
  const data = [
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL, inLanguage: "vi-VN", description: SITE_DESCRIPTION },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Sân Khấu Online",
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
  const { rooms, enabledMaps, online, pricing } = await getHomeData();
  const watching = rooms.reduce((n, r) => n + (r.live?.admitted ?? 0), 0);

  const intro = (
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
  );

  return (
    <div className={`home ${display.variable} ${body.variable}`}>
      <JsonLd rooms={rooms} />
      <div className="stars" aria-hidden />
      <HomeNav />

      <main>
        {/* The whole first screen is a theater. The stage screen shows slides (introduction,
            open rooms, stage types); the house lights can be switched on and off. */}
        <section className="theater" aria-labelledby="hero-h">
          <Spotlight target=".theater" />
          <div className="th-valance" aria-hidden />
          <div className="th-curtain l" aria-hidden />
          <div className="th-curtain r" aria-hidden />
          <div className="th-sconces" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="th-beams" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="th-follow" aria-hidden />

          <div className="th-screen-wrap">
            <div className="th-screen">
              <div className="th-screen-fx" aria-hidden />
              <StageSlides intro={intro} initialRooms={rooms} maps={enabledMaps} />
            </div>
            <div className="th-reflect" aria-hidden />
          </div>

          <div className="th-stage">
            <LightSwitch target=".theater" />
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
          <a className="th-cue" href="#sanh">
            <span>Ra sảnh</span>
            <span aria-hidden>↓</span>
          </a>
        </section>

        <div className="floor" id="sanh">
          <DemoRooms />
          <MyRooms />
          <Lobby pricing={pricing} />
        </div>
      </main>

      <footer className="foot">
        <span>
          © {new Date().getFullYear()} Sân Khấu Online · <a href={SITE_URL}>{SITE_URL.replace(/^https?:\/\//, "")}</a>
        </span>
        <nav aria-label="Liên kết cuối trang">
          <a href="#phong-dang-mo">Phòng đang mở</a>
          <a href="#quay-ve">Quầy vé</a>
          <a href="#hoi-dap">Hỏi đáp</a>
        </nav>
      </footer>
    </div>
  );
}
