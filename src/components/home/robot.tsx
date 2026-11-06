"use client";

import { useId } from "react";

/** Friendly robot behind the reception desk (original SVG). */
export function Receptionist({ className = "" }: { className?: string }) {
  // own gradient id: the robot appears more than once on the home page
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className={`rcp ${className}`} viewBox="0 0 160 150" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`rcp-body-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3570" />
          <stop offset="1" stopColor="#141a3a" />
        </linearGradient>
      </defs>
      <line x1="80" y1="18" x2="80" y2="4" stroke="#3df5ff" strokeWidth="3" />
      <circle className="au-blink" cx="80" cy="4" r="4" fill="#ff4fd8" />
      <rect x="44" y="18" width="72" height="56" rx="18" fill={`url(#rcp-body-${id})`} stroke="#3df5ff" strokeWidth="2.5" />
      <rect x="54" y="32" width="52" height="26" rx="13" fill="#05060f" />
      <g className="rcp-eyes">
        <circle cx="70" cy="45" r="5" fill="#3df5ff" />
        <circle cx="90" cy="45" r="5" fill="#3df5ff" />
      </g>
      <path d="M70 64 Q80 70 90 64" stroke="#b6ff3d" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="40" y="80" width="80" height="70" rx="20" fill={`url(#rcp-body-${id})`} stroke="#8b5cff" strokeWidth="2" />
      <circle cx="80" cy="104" r="9" fill="none" stroke="#ffd38a" strokeWidth="2.5" />
      <path className="rcp-wave" d="M120 96 Q146 84 150 60" stroke="#3df5ff" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M40 100 Q24 112 30 130" stroke="#3df5ff" strokeWidth="9" strokeLinecap="round" fill="none" />
    </svg>
  );
}
