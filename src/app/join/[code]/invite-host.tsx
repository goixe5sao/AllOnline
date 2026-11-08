"use client";

import { createContext, useContext, type ReactNode } from "react";

const InviteHost = createContext("");

export function InviteHostProvider({ name, children }: { name: string; children: ReactNode }) {
  return <InviteHost.Provider value={name}>{children}</InviteHost.Provider>;
}

export function useInviteHost() {
  return useContext(InviteHost);
}
