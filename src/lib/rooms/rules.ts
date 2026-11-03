export type RoomStatus = "draft" | "open" | "expired" | "closed";

export type JoinDecision =
  | { allowed: true }
  | { allowed: false; reason: "ROOM_NOT_FOUND" | "INVALID_ROOM_PASSWORD" | "ROOM_CAPACITY_REACHED" | "ROOM_CLOSED" };

export function calculateWaitingCapacity(
  officialCapacity: number,
  waitingEnabled: boolean,
  waitingRatio = 0.2,
): number {
  if (!waitingEnabled) return 0;
  return Math.floor(officialCapacity * waitingRatio);
}

export function calculateTotalSlots(
  officialCapacity: number,
  waitingEnabled: boolean,
  waitingRatio = 0.2,
): number {
  return officialCapacity + calculateWaitingCapacity(officialCapacity, waitingEnabled, waitingRatio);
}

export function validateRoomName(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 120;
}

export function validateCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 100;
}

export function validateWaitingRatio(ratio: number | null | undefined): boolean {
  const value = ratio ?? 0.2;
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function canAllocateSlotBudget(
  usedSlots: number,
  requestedSlots: number,
  budget: number,
): boolean {
  return usedSlots >= 0 && requestedSlots >= 0 && budget >= 0 && usedSlots + requestedSlots <= budget;
}

export function canJoinRoom(input: {
  status: RoomStatus;
  guestsEnabled: boolean;
  passwordRequired: boolean;
  passwordMatches: boolean;
  activeMembers: number;
  totalSlots: number;
  alreadyActiveMember?: boolean;
}): JoinDecision {
  if (input.status !== "open") return { allowed: false, reason: "ROOM_CLOSED" };
  if (!input.guestsEnabled) return { allowed: false, reason: "ROOM_NOT_FOUND" };
  if (input.passwordRequired && !input.passwordMatches) {
    return { allowed: false, reason: "INVALID_ROOM_PASSWORD" };
  }
  if (!input.alreadyActiveMember && input.activeMembers >= input.totalSlots) {
    return { allowed: false, reason: "ROOM_CAPACITY_REACHED" };
  }
  return { allowed: true };
}
