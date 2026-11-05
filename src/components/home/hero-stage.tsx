/**
 * Hero illustration: a stage of the future watched by a robot, an alien, a human and an AI.
 * Pure SVG + CSS animation (original artwork, no external assets, crisp at any size).
 */
export function HeroStage() {
  return (
    <svg className="hs" viewBox="0 0 1200 640" role="img" aria-labelledby="hs-title" preserveAspectRatio="xMidYMid meet">
      <title id="hs-title">Sân khấu tương lai: robot, người ngoài hành tinh, con người và AI cùng xem một màn hình chung</title>
      <defs>
        <linearGradient id="hs-neon" x1="0" x2="1">
          <stop offset="0" stopColor="#3df5ff" />
          <stop offset="0.5" stopColor="#8b5cff" />
          <stop offset="1" stopColor="#ff4fd8" />
        </linearGradient>
        <linearGradient id="hs-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#101a3d" />
          <stop offset="1" stopColor="#060918" />
        </linearGradient>
        <linearGradient id="hs-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bdf8ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#bdf8ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hs-beam2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb3f1" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffb3f1" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="hs-floor" cx="0.5" cy="0.35" r="0.65">
          <stop offset="0" stopColor="#3b2a8f" stopOpacity="0.9" />
          <stop offset="1" stopColor="#05060f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hs-orb" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#7ff9ff" />
          <stop offset="1" stopColor="#4a2bd8" />
        </radialGradient>
        <filter id="hs-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="hs-screen-clip">
          <rect x="330" y="120" width="540" height="300" rx="18" />
        </clipPath>
      </defs>

      {/* light beams */}
      <polygon className="hs-beam hs-beam-l" points="150,0 230,0 520,470 300,470" fill="url(#hs-beam)" />
      <polygon className="hs-beam hs-beam-r" points="970,0 1050,0 900,470 680,470" fill="url(#hs-beam2)" />

      {/* stage floor */}
      <ellipse cx="600" cy="500" rx="560" ry="120" fill="url(#hs-floor)" />
      <g className="hs-grid" stroke="url(#hs-neon)" strokeOpacity="0.35" strokeWidth="1.2" fill="none">
        <ellipse cx="600" cy="470" rx="420" ry="54" />
        <ellipse cx="600" cy="470" rx="300" ry="36" />
        <ellipse cx="600" cy="470" rx="180" ry="20" />
        <path d="M180 470 L600 470 L1020 470 M600 416 L600 524 M300 440 L900 500 M300 500 L900 440" />
      </g>

      {/* proscenium arch */}
      <path d="M280 470 V150 Q280 70 360 70 H840 Q920 70 920 150 V470" fill="none" stroke="url(#hs-neon)" strokeWidth="6" filter="url(#hs-glow)" />
      <path d="M300 470 V156 Q300 92 364 92 H836 Q900 92 900 156 V470" fill="none" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="2" />

      {/* hologram screen */}
      <rect x="330" y="120" width="540" height="300" rx="18" fill="url(#hs-screen)" stroke="#3df5ff" strokeOpacity="0.6" strokeWidth="2" />
      <g clipPath="url(#hs-screen-clip)">
        <g className="hs-scan">
          <rect x="330" y="120" width="540" height="40" fill="#3df5ff" opacity="0.06" />
        </g>
        {/* rising chart line */}
        <polyline className="hs-chart" points="350,380 410,350 460,365 520,310 580,325 640,270 700,290 760,220 850,190" fill="none" stroke="#b6ff3d" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" filter="url(#hs-glow)" />
        {/* equaliser bars */}
        <g className="hs-eq" fill="url(#hs-neon)" opacity="0.85">
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} x={380 + i * 32} y={340} width="14" height="60" rx="4" style={{ animationDelay: `${(i % 7) * -0.18}s` }} />
          ))}
        </g>
        {/* rings */}
        <g className="hs-rings" fill="none" stroke="#3df5ff" strokeOpacity="0.55">
          <circle cx="600" cy="230" r="70" strokeWidth="2" />
          <circle cx="600" cy="230" r="48" strokeWidth="1.5" strokeDasharray="6 8" />
          <circle cx="600" cy="230" r="94" strokeWidth="1" strokeDasharray="2 10" />
        </g>
        <text x="600" y="240" textAnchor="middle" className="hs-live">
          LIVE
        </text>
      </g>

      {/* audience (foreground silhouettes) */}
      <g className="hs-crowd">
        {/* robot */}
        <g transform="translate(150 470)">
          <line x1="40" y1="-118" x2="40" y2="-140" stroke="#3df5ff" strokeWidth="3" />
          <circle className="hs-blink" cx="40" cy="-144" r="6" fill="#ff4fd8" filter="url(#hs-glow)" />
          <rect x="0" y="-118" width="80" height="62" rx="14" fill="#0d1226" stroke="#3df5ff" strokeWidth="2.5" />
          <rect x="14" y="-98" width="52" height="16" rx="8" fill="#3df5ff" opacity="0.9" filter="url(#hs-glow)" />
          <rect x="-12" y="-50" width="104" height="90" rx="20" fill="#0d1226" stroke="#3df5ff" strokeOpacity="0.6" strokeWidth="2" />
          <circle cx="40" cy="-8" r="10" fill="none" stroke="#b6ff3d" strokeWidth="2" />
        </g>
        {/* alien */}
        <g transform="translate(330 480)">
          <g className="hs-float">
          <path d="M-14 -150 Q-26 -178 -36 -186" stroke="#b6ff3d" strokeWidth="3" fill="none" />
          <path d="M34 -150 Q46 -178 56 -186" stroke="#b6ff3d" strokeWidth="3" fill="none" />
          <circle cx="-37" cy="-188" r="7" fill="#b6ff3d" filter="url(#hs-glow)" />
          <circle cx="57" cy="-188" r="7" fill="#b6ff3d" filter="url(#hs-glow)" />
          <ellipse cx="10" cy="-110" rx="58" ry="66" fill="#0c1a12" stroke="#b6ff3d" strokeWidth="2.5" />
          <ellipse cx="-12" cy="-112" rx="18" ry="26" fill="#05060f" transform="rotate(-18 -12 -112)" />
          <ellipse cx="32" cy="-112" rx="18" ry="26" fill="#05060f" transform="rotate(18 32 -112)" />
          <circle cx="-8" cy="-118" r="5" fill="#b6ff3d" />
          <circle cx="28" cy="-118" r="5" fill="#b6ff3d" />
          <path d="M-46 -40 Q10 -70 66 -40 L76 40 L-56 40 Z" fill="#0c1a12" stroke="#b6ff3d" strokeOpacity="0.6" strokeWidth="2" />
          </g>
        </g>
        {/* human */}
        <g transform="translate(860 480)">
          <circle cx="0" cy="-118" r="40" fill="#14101f" stroke="#ff4fd8" strokeWidth="2.5" />
          <path d="M-38 -128 Q0 -175 38 -128" fill="none" stroke="#ff4fd8" strokeWidth="5" />
          <rect x="-46" y="-140" width="10" height="26" rx="4" fill="#ff4fd8" />
          <rect x="36" y="-140" width="10" height="26" rx="4" fill="#ff4fd8" />
          <path d="M-62 -40 Q0 -84 62 -40 L70 40 L-70 40 Z" fill="#14101f" stroke="#ff4fd8" strokeOpacity="0.6" strokeWidth="2" />
        </g>
        {/* AI orb on a pedestal */}
        <g transform="translate(1040 470)">
          <circle className="hs-orb" cx="0" cy="-120" r="42" fill="url(#hs-orb)" filter="url(#hs-glow)" />
          <ellipse cx="0" cy="-120" rx="64" ry="14" fill="none" stroke="#3df5ff" strokeOpacity="0.7" strokeWidth="2" className="hs-orbit" />
          <path d="M-30 -60 L30 -60 L44 40 L-44 40 Z" fill="#0d1226" stroke="#8b5cff" strokeWidth="2" />
          <text x="0" y="-12" textAnchor="middle" className="hs-ai">
            AI
          </text>
        </g>
      </g>
    </svg>
  );
}
