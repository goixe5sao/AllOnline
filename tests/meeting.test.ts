import { describe, expect, it } from "vitest";
import { MAP_CODES, MAP_INFO, MEETING_TABLE_PER_SIDE, MEETING_TABLE_W, buildLayout } from "@/core/maps";
import { RoomEngine, type EngineSettings } from "@/core/room-engine";

const settings: EngineSettings = { findSeatMs: 300_000, inviteClaimMs: 60_000, requeueCooldownMs: 30_000, reconnectGraceMs: 90_000, chatRadius: 8 };
const person = { group: "people" as const, model: "person-teal" };

describe("meeting room layout", () => {
  it("is a known room type for people / animals", () => {
    expect(MAP_CODES).toContain("meeting");
    expect(MAP_INFO.meeting.groups).toEqual(["people", "animals"]);
  });

  it("one chairperson's seat at the far head, the rest on both sides of the table, facing the screen", () => {
    for (const cap of [1, 2, 7, 12, 21]) {
      const l = buildLayout("meeting", cap);
      expect(l.seats).toHaveLength(cap);
      const chairs = l.seats.filter((s) => s.chair);
      expect(chairs).toHaveLength(1);
      const head = chairs[0];
      expect(head.x).toBe(0);
      for (const s of l.seats) {
        if (s.chair) continue;
        expect(head.z).toBeGreaterThan(s.z); // the head of the table is opposite the screen
        expect(Math.abs(s.x)).toBeGreaterThan(MEETING_TABLE_W / 2); // never inside the table
      }
      // everyone looks toward the wall screen (rotY 0 = −z)
      for (const s of l.seats) expect(Math.abs(s.rotY)).toBeLessThan(Math.PI / 2);
      expect(new Set(l.seats.map((s) => `${s.x},${s.z}`)).size).toBe(cap); // no two chairs in one place
      // screen on the wall in front, the room is a closed box around the seats
      expect(l.screen.z).toBeLessThan(Math.min(...l.seats.map((s) => s.z)));
      expect(l.screen.y - l.screen.height / 2).toBeGreaterThan(0.8);
      for (const s of l.seats) expect(s.x > l.main.minX && s.x < l.main.maxX && s.z < l.main.maxZ).toBe(true);
    }
  });

  it("a big meeting: the table holds 2×10, the others sit in rows along the walls", () => {
    const l = buildLayout("meeting", 31);
    expect(l.seats.filter((s) => s.group === "table")).toHaveLength(MEETING_TABLE_PER_SIDE * 2);
    expect(l.seats.filter((s) => s.group === "wall")).toHaveLength(10);
  });
});

describe("the chairperson's seat", () => {
  const engine = (cap: number) => new RoomEngine({ roomId: "m", entryMode: "auto_assign", officialCapacity: cap, waitingCapacity: 2, layout: buildLayout("meeting", cap) }, settings);
  const chairId = (e: RoomEngine) => e.config.layout.seats.find((s) => s.chair)!.id;

  it("guests are not seated there while another seat is free", () => {
    const e = engine(4);
    for (const id of ["a", "b", "c"]) {
      const r = e.join(id, id, person, 0);
      expect(r.ok && r.member.seatId).not.toBe(chairId(e));
    }
    // last free seat: better a guest there than no seat at all
    const d = e.join("d", "d", person, 0);
    expect(d.ok && d.member.seatId).toBe(chairId(e));
  });

  it("only the owner / a co-host may move to it", () => {
    const e = engine(4);
    e.join("guest", "G", person, 0);
    e.join("owner", "O", person, 0);
    expect(e.changeSeat("guest", chairId(e))).toEqual({ ok: false, code: "CHAIR_RESERVED" });
    expect(e.changeSeat("owner", chairId(e), true)).toEqual({ ok: true });
    expect(e.members.get("owner")!.seatId).toBe(chairId(e));
  });
});
