"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { REACTIONS, REACTION_EMOJI, type ClientMsg, type QuestionDto, type Reaction } from "@/core/protocol";
import { playClap } from "./bell";
import type { MemberStore } from "./use-room";

/** Reaction buttons, raise hand and the Q&A button (bottom-right of the room). */
export function ReactionBar(p: { send: (m: ClientMsg) => void; canHand: boolean; handUp: boolean; onQa: () => void; qaCount: number; qaOpen: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="engage" role="toolbar" aria-label="Tương tác">
      <div className={`engage-reacts ${open ? "open" : ""}`}>
        {REACTIONS.map((r) => (
          <button key={r} type="button" className="engage-btn" aria-label={`Thả ${REACTION_EMOJI[r]}`} onClick={() => p.send({ t: "react", e: r })}>
            {REACTION_EMOJI[r]}
          </button>
        ))}
      </div>
      <button type="button" className="engage-btn engage-toggle" aria-expanded={open} aria-label="Thả cảm xúc" onClick={() => setOpen(!open)}>
        {open ? "✕" : "😊"}
      </button>
      {p.canHand && (
        <button type="button" className={`engage-btn ${p.handUp ? "on" : ""}`} aria-pressed={p.handUp} title={p.handUp ? "Hạ tay" : "Giơ tay xin phát biểu"} onClick={() => p.send({ t: "hand", up: !p.handUp })}>
          ✋
        </button>
      )}
      <button type="button" className={`engage-btn engage-qa ${p.qaOpen ? "on" : ""}`} aria-pressed={p.qaOpen} title="Hỏi đáp" onClick={p.onQa}>
        ❓{p.qaCount > 0 && <span className="engage-count">{p.qaCount}</span>}
      </button>
    </div>
  );
}

/**
 * Emoji rising along the right edge for every reaction in the room (like a live stream), plus a
 * clap sound for 👏 (throttled, follows the room mute switch). Updates without React state per
 * reaction: each one is a short-lived DOM node.
 */
export function ReactionStream({ store, muted, volume, reduceMotion }: { store: MemberStore; muted: boolean; volume: number; reduceMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const opts = useRef({ muted, volume, reduceMotion });
  opts.current = { muted, volume, reduceMotion };
  useEffect(() => {
    let lastClap = 0;
    let live = 0;
    const on = (e: Reaction) => {
      const el = host.current;
      if (el && live < 30) {
        const s = document.createElement("span");
        s.className = "rs-item";
        s.textContent = REACTION_EMOJI[e];
        s.style.left = `${10 + Math.random() * 60}%`;
        s.style.animationDuration = `${opts.current.reduceMotion ? 1.2 : 2.4 + Math.random() * 1.2}s`;
        live++;
        s.addEventListener("animationend", () => {
          s.remove();
          live--;
        });
        el.appendChild(s);
      }
      const now = performance.now();
      if (e === "clap" && !opts.current.muted && now - lastClap > 180) {
        lastClap = now;
        playClap((opts.current.volume / 100) * 0.6);
      }
    };
    store.onReact.add(on);
    return () => {
      store.onReact.delete(on);
    };
  }, [store]);
  return <div className="reaction-stream" ref={host} aria-hidden />;
}

/** Q&A: ask, upvote, and — for the owner / co-hosts — answer, hide or put on the stage. */
export function QaPanel(p: {
  questions: QuestionDto[];
  myVotes: string[];
  selfId: string;
  canAsk: boolean;
  isMod: boolean;
  send: (m: ClientMsg) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"open" | "answered" | "hidden">("open");
  const list = useMemo(
    () =>
      p.questions
        .filter((q) => q.status === tab)
        .sort((a, b) => (tab === "open" ? b.votes - a.votes || a.createdAt - b.createdAt : b.createdAt - a.createdAt)),
    [p.questions, tab],
  );
  const count = (s: QuestionDto["status"]) => p.questions.filter((q) => q.status === s).length;
  return (
    <aside className="side-panel qa-panel" aria-label="Hỏi đáp">
      <div className="row between">
        <strong>❓ Hỏi đáp</strong>
        <button className="hud-btn" onClick={p.onClose} aria-label="Đóng hỏi đáp">
          ✕
        </button>
      </div>
      {p.canAsk ? (
        <form
          className="stack"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) p.send({ t: "q_ask", text: text.trim() });
            setText("");
          }}
        >
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Đặt câu hỏi cho diễn giả… (mọi người trong phòng đều thấy)" aria-label="Câu hỏi" />
          <button className="hud-btn primary" disabled={!text.trim()}>
            Gửi câu hỏi
          </button>
        </form>
      ) : (
        <small>Bạn cần vào phòng như người tham dự để đặt câu hỏi.</small>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "open"} onClick={() => setTab("open")}>
          Đang chờ ({count("open")})
        </button>
        <button role="tab" aria-selected={tab === "answered"} onClick={() => setTab("answered")}>
          Đã trả lời ({count("answered")})
        </button>
        {p.isMod && (
          <button role="tab" aria-selected={tab === "hidden"} onClick={() => setTab("hidden")}>
            Đã ẩn ({count("hidden")})
          </button>
        )}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {list.map((q) => {
          const mine = q.authorId === p.selfId;
          const voted = p.myVotes.includes(q.id);
          return (
            <div key={q.id} className="qa-item">
              <button
                className={`qa-vote ${voted ? "on" : ""}`}
                disabled={mine || q.status !== "open"}
                aria-pressed={voted}
                title={mine ? "Câu hỏi của bạn" : "Ủng hộ câu hỏi này"}
                onClick={() => p.send({ t: "q_vote", id: q.id })}
              >
                ▲<span>{q.votes}</span>
              </button>
              <div className="qa-body">
                <div className="qa-text">{q.text}</div>
                <small>
                  {q.author}
                  {mine && " (bạn)"} · {new Date(q.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                </small>
                {p.isMod && (
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    <button className="hud-btn" onClick={() => p.send({ t: "q_show", id: q.id })}>
                      Lên màn hình
                    </button>
                    {q.status !== "answered" && (
                      <button className="hud-btn" onClick={() => p.send({ t: "q_set", id: q.id, status: "answered" })}>
                        Đã trả lời
                      </button>
                    )}
                    {q.status !== "hidden" ? (
                      <button className="hud-btn" onClick={() => p.send({ t: "q_set", id: q.id, status: "hidden" })}>
                        Ẩn
                      </button>
                    ) : (
                      <button className="hud-btn" onClick={() => p.send({ t: "q_set", id: q.id, status: "open" })}>
                        Hiện lại
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <small>{tab === "open" ? "Chưa có câu hỏi nào. Hãy là người đầu tiên!" : "Trống."}</small>}
      </div>
    </aside>
  );
}

/** Raised hands, for the owner / co-hosts (in the order they were raised). */
export function HandsList({ hands, send }: { hands: { userId: string; name: string; at: number }[]; send: (m: ClientMsg) => void }) {
  if (!hands.length) return null;
  return (
    <div className="notice stack" style={{ gap: 6 }}>
      <strong>✋ Đang giơ tay ({hands.length})</strong>
      {hands.map((h, i) => (
        <div key={h.userId} className="row between">
          <span>
            {i + 1}. {h.name}
          </span>
          <button className="hud-btn" onClick={() => send({ t: "hand_lower", userId: h.userId })}>
            Hạ tay
          </button>
        </div>
      ))}
    </div>
  );
}
