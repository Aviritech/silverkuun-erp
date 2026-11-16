import type { ModuleNavItem } from "../types";

/** Every staff member can bring in clients, so every staff member gets these. */
export const myClientsNav: ModuleNavItem[] = [
  { label: "My clients", href: "/clients" },
  { label: "Sign-up links", href: "/clients/links" },
];
