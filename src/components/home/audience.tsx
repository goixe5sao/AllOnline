/**
 * Rows of seats in front of the stage, seen from behind: humans, robots, aliens and AI orbs,
 * rim-lit by the screen. Original SVG artwork, deterministic (same markup on server and client).
 */

type Kind = "human" | "robot" | "alien" | "orb" | "empty";

// Fixed pattern so the crowd looks varied but never changes between renders.
const PATTERN: Kind[] = ["human", "robot", "alien", "human", "orb", "empty", "alien", "robot", "human", "alien", "human", "robot", "orb", "human", "alien", "empty", "robot"];

const RIM = ["#3df5ff", "#ff4fd8", "#b6ff3d", "#8b5cff"];

function Figure({ kind, x, y, s, i }: { kind: Kind; x: number; y: number; s: number; i: number }) {
  const rim = RIM[i % RIM.length];
  const bob = { animationDelay: `${(i % 5) * -0.7}s` };
  switch (kind) {
    case "human":
      return (
        <g className="au-bob" style={bob} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M-34 0 Q-34 -40 0 -44 Q34 -40 34 0 Z" fill="#0a0b18" stroke={rim} strokeOpacity="0.5" strokeWidth="1.5" />
          <circle cx="0" cy="-66" r="24" fill="#0a0b18" stroke={rim} strokeWidth="2" />
          {i % 3 === 0 ? (
            <>
              <path d="M-24 -70 Q0 -104 24 -70" fill="none" stroke={rim} strokeWidth="4" />
              <rect x="-29" y="-76" width="8" height="16" rx="3" fill={rim} />
              <rect x="21" y="-76" width="8" height="16" rx="3" fill={rim} />
            </>
          ) : (
            <path d="M-22 -74 Q-10 -96 8 -90 Q24 -86 22 -68" fill="#0a0b18" stroke={rim} strokeOpacity="0.6" strokeWidth="2" />
          )}
          {i % 4 === 1 && <line className="au-stick" x1="30" y1="-10" x2="44" y2="-96" stroke={rim} strokeWidth="6" strokeLinecap="round" style={bob} />}
        </g>
      );
    case "robot":
      return (
        <g className="au-bob" style={bob} transform={`translate(${x} ${y}) scale(${s})`}>
          <rect x="-36" y="-40" width="72" height="44" rx="10" fill="#0a0b18" stroke="#3df5ff" strokeOpacity="0.55" strokeWidth="1.5" />
          <rect x="-26" y="-92" width="52" height="44" rx="10" fill="#0a0b18" stroke="#3df5ff" strokeWidth="2" />
          <rect x="-18" y="-78" width="36" height="6" rx="3" fill="#3df5ff" opacity="0.35" />
          <line x1="0" y1="-92" x2="0" y2="-110" stroke="#3df5ff" strokeWidth="3" />
          <circle className="au-blink" cx="0" cy="-114" r="5" fill="#ff4fd8" style={bob} />
        </g>
      );
    case "alien":
      return (
        <g className="au-bob" style={bob} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M-32 0 Q-30 -36 0 -40 Q30 -36 32 0 Z" fill="#081208" stroke="#b6ff3d" strokeOpacity="0.5" strokeWidth="1.5" />
          <ellipse cx="0" cy="-74" rx="30" ry="36" fill="#081208" stroke="#b6ff3d" strokeWidth="2" />
          <path d="M-12 -106 Q-20 -124 -28 -130" fill="none" stroke="#b6ff3d" strokeWidth="2.5" />
          <path d="M12 -106 Q20 -124 28 -130" fill="none" stroke="#b6ff3d" strokeWidth="2.5" />
          <circle className="au-blink" cx="-29" cy="-132" r="5" fill="#b6ff3d" style={bob} />
          <circle className="au-blink" cx="29" cy="-132" r="5" fill="#b6ff3d" style={{ animationDelay: `${(i % 5) * -0.7 - 0.4}s` }} />
        </g>
      );
    case "orb":
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <ellipse cx="0" cy="-8" rx="30" ry="8" fill="#8b5cff" opacity="0.35" />
          <g className="au-float" style={bob}>
            <circle cx="0" cy="-70" r="24" fill="url(#au-orb)" />
            <ellipse cx="0" cy="-70" rx="38" ry="9" fill="none" stroke="#3df5ff" strokeOpacity="0.7" strokeWidth="2" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

function Row({ y, count, seatW, scale, dim, offset }: { y: number; count: number; seatW: number; scale: number; dim: number; offset: number }) {
  const aisle = seatW * 0.9;
  const half = Math.floor(count / 2);
  const total = count * seatW + aisle;
  const x0 = 800 - total / 2;
  const seats = Array.from({ length: count }, (_, k) => {
    const x = x0 + k * seatW + (k >= half ? aisle : 0) + seatW / 2;
    return { x, k };
  });
  return (
    <g opacity={dim}>
      {/* figures sit behind the seat backs */}
      {seats.map(({ x, k }) => (
        <Figure key={`f${k}`} kind={PATTERN[(k + offset) % PATTERN.length]} x={x} y={y + 6 * scale} s={scale} i={k + offset} />
      ))}
      {seats.map(({ x, k }) => (
        <g key={`s${k}`} transform={`translate(${x} ${y})`}>
          <path
            d={`M${-seatW * 0.44} ${40 * scale} V${-6 * scale} Q${-seatW * 0.44} ${-22 * scale} ${-seatW * 0.3} ${-22 * scale} H${seatW * 0.3} Q${seatW * 0.44} ${-22 * scale} ${seatW * 0.44} ${-6 * scale} V${40 * scale} Z`}
            fill="url(#au-seat)"
            stroke="#ff4fd8"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <path d={`M${-seatW * 0.3} ${-21 * scale} H${seatW * 0.3}`} stroke="#ffd6f6" strokeOpacity="0.35" strokeWidth="2" />
        </g>
      ))}
    </g>
  );
}

export function Audience() {
  return (
    <svg className="au" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id="au-seat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a1238" />
          <stop offset="0.5" stopColor="#2a0a24" />
          <stop offset="1" stopColor="#12040f" />
        </linearGradient>
        <radialGradient id="au-orb" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#7ff9ff" />
          <stop offset="1" stopColor="#4a2bd8" />
        </radialGradient>
        <linearGradient id="au-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--h-bg)" }} stopOpacity="0" />
          <stop offset="1" style={{ stopColor: "var(--h-bg)" }} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <Row y={150} count={17} seatW={92} scale={0.62} dim={0.55} offset={3} />
      <Row y={250} count={13} seatW={122} scale={0.82} dim={0.8} offset={7} />
      <Row y={372} count={9} seatW={178} scale={1.12} dim={1} offset={0} />
      <rect x="0" y="330" width="1600" height="90" fill="url(#au-fade)" />
    </svg>
  );
}
