import type { AvatarGroup, EntryMode, MapCode } from "./maps";
import type { PersonalState, PublicMember } from "./room-engine";
import type { ScreenAction, ScreenState } from "./screen";

/** Persistent promo strip shown at the bottom of every stage screen. */
export interface StageAd {
  text: string;
  url: string;
}

export type RoomRole = "owner" | "participant" | "observer";

export interface PollViewDto {
  id: string;
  question: string;
  options: { id: string; label: string; votes: number; pct: number }[];
  status: "draft" | "open" | "closed";
  totalVoters: number;
  verifiedOnly: boolean;
}

export interface RoomInfoDto {
  id: string;
  name: string;
  description: string;
  map: MapCode;
  entryMode: EntryMode;
  officialCapacity: number;
  waitingCapacity: number;
  avatarGroups: AvatarGroup[];
  expiresAt: number;
  isTrial: boolean;
}

export type ClientMsg =
  | { t: "join"; roomId: string; pass?: string; avatar?: { group: AvatarGroup; model: string } }
  | { t: "leave" }
  | { t: "move"; x: number; z: number; rotY: number }
  | { t: "claim"; seatId: string }
  | { t: "change_seat"; seatId: string }
  | { t: "accept_invite" }
  | { t: "chat"; text: string }
  | { t: "vote"; pollId: string; optionId: string }
  | { t: "ping"; c: number }
  // owner only
  | { t: "observe"; x: number; z: number }
  | ({ t: "screen" } & ScreenAction)
  | { t: "promote_chat"; id: string }
  | { t: "kick"; userId: string }
  | { t: "poll_create"; question: string; options: string[]; verifiedOnly?: boolean }
  | { t: "poll_open"; id: string }
  | { t: "poll_close"; id: string }
  | { t: "poll_show"; id: string };

export type ServerMsg =
  | {
      t: "welcome";
      role: RoomRole;
      you: { userId: string; name: string; isGuest: boolean };
      room: RoomInfoDto;
      members: PublicMember[];
      screen: ScreenState;
      polls: PollViewDto[];
      myVotes: Record<string, string>;
      personal: PersonalState | null;
      serverNow: number;
      settings: { chatRadius: number; chatMaxLength: number; warningMinutes: number[]; findSeatSeconds: number };
      ad: StageAd | null;
    }
  | { t: "members"; upsert: PublicMember[]; remove: { userId: string; reason: string }[] }
  | { t: "you"; personal: PersonalState | null }
  | { t: "chat"; id: string; from: string; name: string; text: string; at: number }
  | { t: "screen"; state: ScreenState }
  | { t: "poll"; poll: PollViewDto }
  | { t: "my_vote"; pollId: string; optionId: string }
  | { t: "room"; expiresAt: number }
  | { t: "ad"; ad: StageAd | null }
  | { t: "room_closed"; reason: string }
  | { t: "kicked" }
  | { t: "session_replaced" }
  | { t: "corrected"; x: number; z: number }
  | { t: "error"; code: string; message: string }
  | { t: "pong"; c: number; s: number };

export const ERROR_TEXT: Record<string, string> = {
  ROOM_FULL: "Phòng đã đủ người (kể cả khu chờ).",
  BANNED: "Bạn đã bị mời ra khỏi phòng này.",
  ROOM_NOT_OPEN: "Phòng đã đóng hoặc hết hạn.",
  NO_PASS: "Bạn cần vào phòng qua link mời.",
  SEAT_TAKEN: "Chỗ này vừa có người khác ngồi.",
  TOO_FAR: "Hãy đến gần chỗ trống hơn rồi bấm “Vào chỗ”.",
  NOT_FINDING: "Bạn chưa được vào khu chính.",
  FIND_TIME_OVER: "Đã hết thời gian tìm chỗ.",
  NOT_SEATED: "Bạn chưa có chỗ.",
  NOT_INVITED: "Lời mời không còn hiệu lực.",
  INVITE_EXPIRED: "Lời mời đã hết hạn.",
  CHAT_RATE: "Bạn gửi quá nhanh, đợi một chút.",
  CHAT_SPAM: "Tin nhắn lặp lại bị chặn.",
  FORBIDDEN: "Bạn không có quyền thao tác này.",
  INVALID: "Dữ liệu không hợp lệ.",
  NOT_A_PARTICIPANT: "Chỉ người tham dự đã được nhận vào phòng mới được bình chọn.",
  AVATAR_NOT_ALLOWED: "Đối tượng đại diện này không được phép trong phòng.",
  IP_LIMIT_PARTICIPANT: "Mạng (IP) bạn đang dùng đã đạt số người tham dự tối đa. Thử lại sau hoặc dùng mạng khác (ví dụ 4G).",
  DEVICE_LIMIT: "Thiết bị/trình duyệt này đã có một người đang tham dự. Mỗi thiết bị chỉ một người vào phòng tại một thời điểm.",
  VERIFIED_ONLY: "Bình chọn này chỉ dành cho người có tài khoản đã đăng ký. Bạn vẫn xem được kết quả.",
};
