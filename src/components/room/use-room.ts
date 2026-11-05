"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { publishLiveBars } from "./market-live";
import { ERROR_TEXT, type StageAd, type ClientMsg, type PollViewDto, type QuestionDto, type Reaction, type RoomInfoDto, type RoomRole, type ServerMsg } from "@/core/protocol";
import type { PersonalState, PublicMember } from "@/core/room-engine";
import { BLANK_SCREEN, type ScreenState } from "@/core/screen";
import type { AvatarGroup } from "@/core/maps";

export interface ChatLine {
  id: string;
  from: string;
  name: string;
  text: string;
  at: number;
}

export type ConnState = "connecting" | "open" | "reconnecting" | "ended";

export interface RoomSession {
  conn: ConnState;
  endReason: string | null;
  role: RoomRole | null;
  you: { userId: string; name: string; isGuest: boolean; isRoomOwner: boolean; isModerator: boolean } | null;
  hands: { userId: string; name: string; at: number }[];
  questions: QuestionDto[];
  myQuestionVotes: string[];
  room: RoomInfoDto | null;
  screen: ScreenState;
  polls: PollViewDto[];
  myVotes: Record<string, string>;
  personal: PersonalState | null;
  settings: { chatRadius: number; chatMaxLength: number; warningMinutes: number[]; findSeatSeconds: number } | null;
  chat: ChatLine[];
  toast: string | null;
  ad: StageAd | null;
  /** Bumps when membership/status/seat changes (not on pure movement). */
  version: number;
}

/** Members live in a mutable map so 10 Hz movement does not re-render React. */
export class MemberStore {
  map = new Map<string, PublicMember>();
  bubbles = new Map<string, { text: string; at: number }>();
  /** Last reaction per member (shown above the avatar for a moment). */
  reacts = new Map<string, { e: Reaction; at: number }>();
  /** Every reaction in the room, for the rising-emoji stream (trimmed). */
  stream: { id: number; e: Reaction; at: number }[] = [];
  /** Listeners for new reactions (stream overlay, clap sound) without re-rendering React. */
  onReact = new Set<(e: Reaction, from: string) => void>();
  correction: { x: number; z: number } | null = null;
}

export function useRoom(roomId: string, opts: { pass: string | null; avatar: { group: AvatarGroup; model: string } | null; asParticipant?: boolean }) {
  const store = useRef(new MemberStore()).current;
  const [s, setS] = useState<RoomSession>({
    conn: "connecting",
    endReason: null,
    role: null,
    you: null,
    room: null,
    screen: BLANK_SCREEN,
    polls: [],
    myVotes: {},
    personal: null,
    settings: null,
    chat: [],
    toast: null,
    ad: null,
    version: 0,
    hands: [],
    questions: [],
    myQuestionVotes: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const endedRef = useRef(false);
  const retryRef = useRef(0);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    endedRef.current = false;

    const toast = (text: string) => {
      setS((p) => ({ ...p, toast: text }));
      setTimeout(() => setS((p) => (p.toast === text ? { ...p, toast: null } : p)), 4000);
    };

    const end = (reason: string) => {
      endedRef.current = true;
      setS((p) => ({ ...p, conn: "ended", endReason: reason }));
      wsRef.current?.close();
    };

    const onMsg = (m: ServerMsg) => {
      switch (m.t) {
        case "welcome":
          offsetRef.current = m.serverNow - Date.now();
          retryRef.current = 0;
          store.map = new Map(m.members.map((x) => [x.userId, x]));
          setS((p) => ({
            ...p,
            conn: "open",
            role: m.role,
            you: m.you,
            room: m.room,
            screen: m.screen,
            polls: m.polls,
            myVotes: m.myVotes,
            personal: m.personal,
            settings: m.settings,
            ad: m.ad,
            hands: m.hands,
            questions: m.questions,
            myQuestionVotes: m.myQuestionVotes,
            version: p.version + 1,
          }));
          return;
        case "react": {
          const at = Date.now();
          store.reacts.set(m.from, { e: m.e, at });
          store.stream = [...store.stream.filter((x) => at - x.at < 4000).slice(-40), { id: at + Math.random(), e: m.e, at }];
          for (const f of store.onReact) f(m.e, m.from);
          return;
        }
        case "hands":
          setS((p) => ({ ...p, hands: m.hands }));
          return;
        case "question":
          setS((p) => ({ ...p, questions: p.questions.some((x) => x.id === m.q.id) ? p.questions.map((x) => (x.id === m.q.id ? m.q : x)) : [...p.questions, m.q] }));
          return;
        case "question_remove":
          setS((p) => ({ ...p, questions: p.questions.filter((x) => x.id !== m.id) }));
          return;
        case "my_qvote":
          setS((p) => ({ ...p, myQuestionVotes: m.on ? [...p.myQuestionVotes, m.id] : p.myQuestionVotes.filter((x) => x !== m.id) }));
          return;
        case "stage_style":
          setS((p) => (p.room ? { ...p, room: { ...p.room, stageStyle: m.style } } : p));
          return;
        case "mod":
          setS((p) => (p.you ? { ...p, you: { ...p.you, isModerator: m.isModerator } } : p));
          toast(m.isModerator ? "Bạn vừa được chủ phòng chọn làm trợ lý điều hành." : "Bạn không còn là trợ lý điều hành.");
          return;
        case "members": {
          let structural = m.remove.length > 0;
          for (const r of m.remove) store.map.delete(r.userId);
          for (const u of m.upsert) {
            const prev = store.map.get(u.userId);
            if (!prev || prev.status !== u.status || prev.seatId !== u.seatId || prev.connected !== u.connected) structural = true;
            store.map.set(u.userId, u);
          }
          if (structural) setS((p) => ({ ...p, version: p.version + 1 }));
          return;
        }
        case "you":
          setS((p) => ({ ...p, personal: m.personal }));
          return;
        case "chat":
          store.bubbles.set(m.from, { text: m.text, at: Date.now() });
          setS((p) => ({ ...p, chat: [...p.chat.slice(-29), { id: m.id, from: m.from, name: m.name, text: m.text, at: m.at }] }));
          return;
        case "screen":
          setS((p) => ({ ...p, screen: m.state }));
          return;
        case "poll":
          setS((p) => {
            const exists = p.polls.some((x) => x.id === m.poll.id);
            return { ...p, polls: exists ? p.polls.map((x) => (x.id === m.poll.id ? m.poll : x)) : [...p.polls, m.poll] };
          });
          return;
        case "my_vote":
          setS((p) => ({ ...p, myVotes: { ...p.myVotes, [m.pollId]: m.optionId } }));
          return;
        case "room":
          setS((p) => (p.room ? { ...p, room: { ...p.room, expiresAt: m.expiresAt } } : p));
          toast("Thời hạn phòng đã được cập nhật.");
          return;
        case "ad":
          setS((p) => ({ ...p, ad: m.ad }));
          return;
        case "market":
          // Live bars go straight to the chart (no React state update every second here).
          publishLiveBars(m.symbol, m.bars);
          return;
        case "room_closed":
          return end(m.reason === "expired" ? "Phòng đã hết hạn và được đóng." : "Phòng đã được đóng.");
        case "kicked":
          return end("Bạn đã được mời ra khỏi phòng.");
        case "session_replaced":
          return end("Tài khoản này vừa mở phòng ở một tab hoặc thiết bị khác, nên phiên ở tab này đã dừng. Mỗi tài khoản chỉ có một phiên trong phòng tại một thời điểm.");
        case "corrected":
          store.correction = { x: m.x, z: m.z };
          return;
        case "error":
          if (["ROOM_FULL", "BANNED", "ROOM_NOT_OPEN", "NO_PASS", "AVATAR_NOT_ALLOWED", "IP_LIMIT_PARTICIPANT", "DEVICE_LIMIT"].includes(m.code)) return end(m.message || ERROR_TEXT[m.code] || m.code);
          toast(m.message || ERROR_TEXT[m.code] || m.code);
          return;
        case "pong": {
          const rtt = Date.now() - m.c;
          offsetRef.current = m.s + rtt / 2 - Date.now();
          return;
        }
      }
    };

    const connect = async () => {
      if (disposed || endedRef.current) return;
      try {
        const { ticket } = await api<{ ticket: string }>("/api/ws-ticket");
        // The effect may have been disposed while the ticket was loading (unmount / StrictMode).
        if (disposed || endedRef.current) return;
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(JSON.stringify({ t: "join", roomId, pass: opts.pass ?? undefined, avatar: opts.avatar ?? undefined, asParticipant: opts.asParticipant || undefined } satisfies ClientMsg));
          pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "ping", c: Date.now() })), 10_000);
        };
        ws.onmessage = (e) => {
          if (disposed || wsRef.current !== ws) return;
          try {
            onMsg(JSON.parse(e.data));
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = () => {
          clearInterval(pingTimer);
          if (disposed || endedRef.current) return;
          setS((p) => ({ ...p, conn: "reconnecting" }));
          const delay = Math.min(10_000, 1000 * 2 ** retryRef.current++);
          timer = setTimeout(connect, delay);
        };
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) return end("Phiên đăng nhập đã hết, vui lòng đăng nhập lại.");
        setS((p) => ({ ...p, conn: "reconnecting" }));
        timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retryRef.current++));
      }
    };
    connect();
    const online = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN && !endedRef.current) {
        clearTimeout(timer);
        connect();
      }
    };
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(pingTimer);
      window.removeEventListener("online", online);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const leave = useCallback(() => {
    send({ t: "leave" });
    endedRef.current = true;
    wsRef.current?.close();
  }, [send]);

  return { session: s, store, send, serverNow, leave };
}
