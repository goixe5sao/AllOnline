import { describe, expect, it } from "vitest";
import { buildLayout } from "@/core/maps";
import { RoomEngine, type EngineSettings } from "@/core/room-engine";

const settings: EngineSettings = {
  findSeatMs: 300_000,
  inviteClaimMs: 60_000,
  requeueCooldownMs: 30_000,
  reconnectGraceMs: 90_000,
  chatRadius: 8,
};
const person = { group: "people" as const, model: "person-teal" };

function engine(mode: "auto_assign" | "gate_entry", official = 3, waiting = 1, map: "hall" | "drive_in" = "hall") {
  return new RoomEngine({ roomId: "r1", entryMode: mode, officialCapacity: official, waitingCapacity: waiting, layout: buildLayout(map, official) }, settings);
}

describe("auto-assign mode", () => {
  it("seats people nearest the screen first and faces the screen", () => {
    const e = engine("auto_assign");
    const a = e.join("a", "A", person, 0);
    expect(a.ok && a.member.seatId).toBe("S1");
    const b = e.join("b", "B", person, 0);
    expect(b.ok && b.member.seatId).toBe("S2");
  });

  it("puts overflow in the waiting area, then rejects beyond total slots", () => {
    const e = engine("auto_assign", 2, 1);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    const c = e.join("c", "C", person, 0);
    expect(c.ok && c.member.status).toBe("waiting");
    expect(e.join("d", "D", person, 0)).toEqual({ ok: false, code: "ROOM_FULL" });
    expect(e.members.size).toBe(3);
  });

  it("invites the first waiting person when a seat frees, with a claim deadline", () => {
    const e = engine("auto_assign", 1, 2);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 1);
    e.join("c", "C", person, 2);
    e.leave("a", 10);
    expect(e.members.get("b")!.status).toBe("invited");
    expect(e.members.get("c")!.status).toBe("waiting");
    expect(e.acceptInvite("b", 20)).toEqual({ ok: true });
    expect(e.members.get("b")!.status).toBe("seated");
  });

  it("an expired invitation goes to the next person and the first one is re-queued with cooldown", () => {
    const e = engine("auto_assign", 1, 2);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 1);
    e.join("c", "C", person, 2);
    e.leave("a", 0);
    e.tick(60_000);
    expect(e.members.get("c")!.status).toBe("invited");
    expect(e.members.get("b")!.status).toBe("waiting");
    expect(e.personal("b")!.queuePosition).toBe(1);
    expect(e.acceptInvite("b", 60_001)).toEqual({ ok: false, code: "NOT_INVITED" });
  });

  it("change seat is validated by the server", () => {
    const e = engine("auto_assign", 3, 0);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    expect(e.changeSeat("a", "S2")).toEqual({ ok: false, code: "SEAT_TAKEN" });
    expect(e.changeSeat("a", "S99")).toEqual({ ok: false, code: "NO_SUCH_SEAT" });
    expect(e.changeSeat("a", "S3")).toEqual({ ok: true });
    expect(e.occupiedSeats().sort()).toEqual(["S2", "S3"]);
  });
});

describe("gate-entry mode", () => {
  it("admits to the main area with a 5-minute seat-finding timer", () => {
    const e = engine("gate_entry", 2, 1);
    const r = e.join("a", "A", person, 1000);
    expect(r.ok && r.member.status).toBe("finding");
    expect(r.ok && r.member.deadline).toBe(301_000);
  });

  it("only one of many contenders gets the same seat", () => {
    const e = engine("gate_entry", 3, 0);
    for (const id of ["a", "b", "c"]) e.join(id, id, person, 0);
    const seat = buildLayout("hall", 3).seats[0];
    for (const id of ["a", "b", "c"]) {
      const m = e.members.get(id)!;
      m.x = seat.x;
      m.z = seat.z;
    }
    const results = ["a", "b", "c"].map((id) => e.claimSeat(id, seat.id, 10));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "SEAT_TAKEN")).toHaveLength(2);
  });

  it("refuses to claim a seat from far away", () => {
    const e = engine("gate_entry", 2, 0);
    e.join("a", "A", person, 0);
    expect(e.claimSeat("a", "S1", 1)).toEqual({ ok: false, code: "TOO_FAR" });
  });

  it("does not admit more people to search than free official seats", () => {
    const e = engine("gate_entry", 2, 3);
    for (const id of ["a", "b", "c", "d"]) e.join(id, id, person, 0);
    expect(e.countBy("finding")).toBe(2);
    expect(e.countBy("waiting")).toBe(2);
  });

  it("after 5 minutes without a seat the person goes back outside the gate, the next is admitted", () => {
    const e = engine("gate_entry", 1, 1);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    e.tick(299_999);
    expect(e.members.get("a")!.status).toBe("finding");
    e.tick(300_000);
    expect(e.members.get("a")!.status).toBe("waiting");
    expect(e.members.get("b")!.status).toBe("finding");
    // a has a cooldown and is not re-admitted automatically right away.
    e.leave("b", 300_001);
    expect(e.members.get("a")!.status).toBe("waiting");
    e.tick(330_000);
    expect(e.members.get("a")!.status).toBe("finding");
  });

  it("movement is clamped to the allowed zone and speed-limited", () => {
    const e = engine("gate_entry", 2, 1);
    e.join("a", "A", person, 0);
    const before = { ...e.members.get("a")! };
    const r = e.move("a", before.x + 50, before.z - 50, 0, 100);
    expect(r.corrected).toBe(true);
    const after = e.members.get("a")!;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(2);
  });

  it("waiting people cannot walk through the gate", () => {
    const e = engine("gate_entry", 1, 1);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    const layout = buildLayout("hall", 1);
    for (let t = 1; t < 40; t++) e.move("b", 0, -100, 0, t * 100);
    expect(e.members.get("b")!.z).toBeGreaterThanOrEqual(layout.waiting.minZ);
  });
});

describe("disconnect and reconnect", () => {
  it("keeps the seat during the grace period and restores it", () => {
    const e = engine("auto_assign", 2, 0);
    e.join("a", "A", person, 0);
    e.disconnect("a", 1000);
    e.tick(50_000);
    const r = e.join("a", "A", person, 60_000);
    expect(r.ok && r.resumed).toBe(true);
    expect(r.ok && r.member.seatId).toBe("S1");
  });

  it("releases the seat after the grace period and serves the queue", () => {
    const e = engine("auto_assign", 1, 1);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    e.disconnect("a", 1000);
    e.tick(91_000);
    expect(e.members.has("a")).toBe(false);
    expect(e.members.get("b")!.status).toBe("invited");
  });

  it("closed tab: the place is kept only for the short hold; a reload inside it resumes", () => {
    const e = engine("auto_assign", 2, 0);
    e.join("a", "A", person, 0);
    e.disconnect("a", 1000, "closed_tab", 15_000);
    const pub = e.publicMember(e.members.get("a")!);
    expect(pub).toMatchObject({ connected: false, offAt: 1000, holdUntil: 16_000, offReason: "closed_tab" });
    e.tick(10_000);
    const r = e.join("a", "A", person, 12_000); // reload
    expect(r.ok && r.resumed && r.member.seatId).toBe("S1");
    expect(e.publicMember(e.members.get("a")!).offAt).toBeUndefined();
    const logs = e.drain().logs;
    expect(logs.find((l) => l.type === "disconnected")?.data).toMatchObject({ reason: "closed_tab", holdSec: 15 });
    expect(logs.find((l) => l.type === "reconnected")?.data).toMatchObject({ awaySec: 11, reason: "closed_tab" });

    e.disconnect("a", 20_000, "closed_tab", 15_000);
    e.tick(35_000);
    expect(e.members.has("a")).toBe(false);
    expect(e.drain().logs.find((l) => l.type === "grace_expired")?.data).toMatchObject({ reason: "closed_tab" });
  });

  it("a phone that stopped answering keeps the full grace; the hold never exceeds it", () => {
    const e = engine("auto_assign", 2, 0);
    e.join("a", "A", person, 0);
    e.disconnect("a", 0, "no_response");
    e.tick(60_000);
    expect(e.members.has("a")).toBe(true);
    expect(e.publicMember(e.members.get("a")!).holdUntil).toBe(90_000);
    e.join("a", "A", person, 61_000);
    e.disconnect("a", 70_000, "network", 999_999);
    expect(e.publicMember(e.members.get("a")!).holdUntil).toBe(160_000);
  });

  it("kicked users cannot rejoin", () => {
    const e = engine("auto_assign", 2, 0);
    e.join("a", "A", person, 0);
    e.kick("a", "owner", 1);
    expect(e.join("a", "A", person, 2)).toEqual({ ok: false, code: "BANNED" });
  });
});

describe("proximity chat recipients", () => {
  it("only includes connected people within the radius", () => {
    const e = engine("gate_entry", 3, 0);
    e.join("a", "A", person, 0);
    e.join("b", "B", person, 0);
    e.join("c", "C", person, 0);
    e.members.get("a")!.x = 0;
    e.members.get("a")!.z = 0;
    e.members.get("b")!.x = 5;
    e.members.get("b")!.z = 0;
    e.members.get("c")!.x = 30;
    e.members.get("c")!.z = 0;
    expect(e.chatRecipients("a").sort()).toEqual(["a", "b"]);
    e.disconnect("b", 1);
    expect(e.chatRecipients("a")).toEqual(["a"]);
    e.setObserver("owner", 3, 0);
    expect(e.chatRecipients("a").sort()).toEqual(["a", "owner"]);
  });
});

describe("layouts", () => {
  it.each(["hall", "carpet", "tables", "drive_in"] as const)("%s has exactly one seat per official place, all facing the screen", (map) => {
    const l = buildLayout(map, 37);
    expect(l.seats).toHaveLength(37);
    expect(new Set(l.seats.map((s) => s.id)).size).toBe(37);
    for (const s of l.seats) {
      const fx = -Math.sin(s.rotY);
      const fz = -Math.cos(s.rotY);
      const tx = l.screen.x - s.x;
      const tz = l.screen.z - s.z;
      expect((fx * tx + fz * tz) / Math.hypot(tx, tz)).toBeGreaterThan(0.99);
    }
    expect(l.waiting.minZ).toBeGreaterThan(l.main.maxZ);
  });

  it("drive-in rows rise toward the back so front cars block less", () => {
    const l = buildLayout("drive_in", 24);
    const front = l.seats.find((s) => s.rank === 0)!;
    const back = l.seats.reduce((a, b) => (b.z > a.z ? b : a));
    expect(back.y).toBeGreaterThan(front.y);
  });
});
