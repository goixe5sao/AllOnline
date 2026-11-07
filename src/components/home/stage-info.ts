import type { MapCode } from "@/core/maps";

export const MAP_SHORT: Record<MapCode, string> = { hall: "Hội trường", carpet: "Thảm ngồi", tables: "Khu bàn", drive_in: "Rạp ô tô", meeting: "Phòng họp" };

/** Marketing copy for each stage type (home page). */
export const STAGE_COPY: Record<MapCode, { tag: string; fit: string }> = {
  hall: { tag: "Hội nghị · lớp học · ra mắt", fit: "Ghế dốc như rạp thật, lối đi giữa, cổng và khu chờ." },
  carpet: { tag: "Thiền · trò chuyện · cộng đồng", fit: "Thảm ngồi so le quanh màn hình chung — gần gũi, thư thái." },
  tables: { tag: "Workshop · nhóm · networking", fit: "Mỗi bàn 4 chỗ, chat với người cùng bàn." },
  drive_in: { tag: "Chiếu phim · đêm nhạc · sự kiện lớn", fit: "Rạp ngoài trời buổi tối, ô đỗ dốc dần và so le; xem từ ghế lái." },
  meeting: { tag: "Họp công ty · họp HĐQT · thuyết trình", fit: "Bàn họp dài, ghế chủ tọa ở đầu bàn, màn chiếu gắn tường như văn phòng thật." },
};
