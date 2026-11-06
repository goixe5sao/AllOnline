/**
 * Room kits: a furnished room type draws its own world (walls, floor, furniture, lights) and its
 * own seats instead of the default stage hall. Adding a room type = a layout in
 * src/core/maps.ts + (optionally) a kit registered here. Maps without a kit use the stage hall.
 */
import type { ComponentType, ReactNode } from "react";
import type { Layout, MapCode } from "@/core/maps";
import { MeetingSeats, MeetingWorld } from "./meeting";

export interface KitProps {
  layout: Layout;
  /** Room lights on ("Tắt đèn" dims the room). */
  lights: boolean;
  lite: boolean;
  children?: ReactNode;
}
export interface KitSeatsProps {
  layout: Layout;
  /** The viewer's own seat (its backrest is left out so it does not fill the view). */
  ownSeat: string | null;
}
export interface RoomKit {
  World: ComponentType<KitProps>;
  Seats: ComponentType<KitSeatsProps>;
  /** Where the owner's camera starts (default: high above, behind the last row). */
  ownerCamera?: (layout: Layout) => { position: [number, number, number]; target: [number, number, number] };
}

export const ROOM_KITS: Partial<Record<MapCode, RoomKit>> = {
  meeting: {
    World: MeetingWorld,
    Seats: MeetingSeats,
    // a small room: closer, looking in over the back wall
    ownerCamera: (l) => ({ position: [0, 6 + l.main.maxZ * 0.35, l.main.maxZ + 3.5], target: [0, 0.6, (l.main.minZ + l.main.maxZ) / 2] }),
  },
};
