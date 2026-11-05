"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Có mã mời?" — accepts a bare code or a full invite link. */
export function JoinCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="join-code"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().split("/").pop();
        if (c) router.push(`/join/${encodeURIComponent(c.toUpperCase())}`);
      }}
    >
      <label htmlFor="join-code-input" className="sr-only">
        Mã mời hoặc link mời
      </label>
      <input id="join-code-input" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Có mã mời? Ví dụ K7QX2MPA" autoComplete="off" />
      <button type="submit">Vào phòng</button>
    </form>
  );
}
