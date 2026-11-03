"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

// WebGL scene only runs in the browser.
const RoomView = dynamic(() => import("@/components/room/room-view").then((m) => m.RoomView), { ssr: false, loading: () => <p style={{ padding: 16 }}>Đang tải không gian 3D…</p> });

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  return <RoomView roomId={id} />;
}
