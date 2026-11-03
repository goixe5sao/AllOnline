import { describe, expect, it } from "vitest";
import {
  calculateTotalSlots,
  calculateWaitingCapacity,
  canAllocateSlotBudget,
  canJoinRoom,
  validateCapacity,
  validateRoomName,
  validateWaitingRatio,
} from "@/lib/rooms/rules";

describe("AllOnline room business rules", () => {
  it.each([
    [1, true, 0.2, 0],
    [4, true, 0.2, 0],
    [5, true, 0.2, 1],
    [10, true, 0.2, 2],
    [11, true, 0.2, 2],
    [20, true, 0.25, 5],
    [40, true, 0.5, 20],
    [100, true, 1, 100],
    [100, false, 1, 0],
    [50, false, 0, 0],
  ])("calculates waiting capacity for case %#", (capacity, enabled, ratio, expected) => {
    expect(calculateWaitingCapacity(capacity, enabled, ratio)).toBe(expected);
  });

  it.each([
    [1, true, 0.2, 1],
    [5, true, 0.2, 6],
    [10, true, 0.2, 12],
    [11, true, 0.2, 13],
    [20, true, 0.25, 25],
    [40, true, 0.5, 60],
    [100, true, 1, 200],
    [100, false, 1, 100],
  ])("calculates total slots for case %#", (capacity, enabled, ratio, expected) => {
    expect(calculateTotalSlots(capacity, enabled, ratio)).toBe(expected);
  });

  it.each([
    ["A", true],
    ["Phòng họp", true],
    ["  Tên có khoảng trắng  ", true],
    ["x".repeat(120), true],
    ["", false],
    ["   ", false],
    [null, false],
    [undefined, false],
    ["x".repeat(121), false],
  ])("validates room names for case %#", (name, expected) => {
    expect(validateRoomName(name)).toBe(expected);
  });

  it.each([
    [1, true],
    [50, true],
    [100, true],
    [0, false],
    [101, false],
    [1.5, false],
    [Number.NaN, false],
  ])("validates capacities for case %#", (capacity, expected) => {
    expect(validateCapacity(capacity)).toBe(expected);
  });

  it.each([
    [0, true],
    [0.2, true],
    [1, true],
    [null, true],
    [undefined, true],
    [-0.01, false],
    [1.01, false],
    [Number.NaN, false],
  ])("validates waiting ratios for case %#", (ratio, expected) => {
    expect(validateWaitingRatio(ratio)).toBe(expected);
  });

  it.each([
    [0, 100, 100, true],
    [40, 60, 100, true],
    [40, 61, 100, false],
    [100, 1, 100, false],
    [0, 0, 0, true],
    [-1, 1, 100, false],
    [1, -1, 100, false],
    [1, 1, -1, false],
  ])("checks slot budget for case %#", (used, requested, budget, expected) => {
    expect(canAllocateSlotBudget(used, requested, budget)).toBe(expected);
  });

  const base = {
    status: "open" as const,
    guestsEnabled: true,
    passwordRequired: false,
    passwordMatches: true,
    activeMembers: 0,
    totalSlots: 10,
  };

  it.each([
    [base, true],
    [{ ...base, passwordRequired: true, passwordMatches: true }, true],
    [{ ...base, activeMembers: 9 }, true],
    [{ ...base, activeMembers: 10 }, false],
    [{ ...base, activeMembers: 11 }, false],
    [{ ...base, passwordRequired: true, passwordMatches: false }, false],
    [{ ...base, guestsEnabled: false }, false],
    [{ ...base, status: "draft" as const }, false],
    [{ ...base, status: "expired" as const }, false],
    [{ ...base, status: "closed" as const }, false],
    [{ ...base, activeMembers: 10, alreadyActiveMember: true }, true],
    [{ ...base, activeMembers: 100, alreadyActiveMember: true }, true],
  ])("decides room joining for case %#", (input, allowed) => {
    expect(canJoinRoom(input).allowed).toBe(allowed);
  });

  it("returns stable error codes for rejected joins", () => {
    expect(canJoinRoom({ ...base, passwordRequired: true, passwordMatches: false })).toEqual({
      allowed: false,
      reason: "INVALID_ROOM_PASSWORD",
    });
    expect(canJoinRoom({ ...base, activeMembers: 10 })).toEqual({
      allowed: false,
      reason: "ROOM_CAPACITY_REACHED",
    });
    expect(canJoinRoom({ ...base, status: "closed" })).toEqual({
      allowed: false,
      reason: "ROOM_CLOSED",
    });
  });
});
