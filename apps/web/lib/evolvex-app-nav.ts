export type EvolvexAppNavItem = {
  icon: string;
  label: string;
  href: string;
  kicker: string;
  title: string;
};

export const EVOLVEX_APP_NAV: EvolvexAppNavItem[] = [
  {
    icon: "⌕",
    label: "Investigations",
    href: "/investigations",
    kicker: "⊙ ACTIVE CASE FILES",
    title: "Investigations",
  },
  {
    icon: "⛓",
    label: "Service Map",
    href: "/service-map",
    kicker: "⊙ DEPENDENCY GRAPH",
    title: "Service Map",
  },
  {
    icon: "▤",
    label: "Logs",
    href: "/logs",
    kicker: "⊙ SIGNAL STREAM",
    title: "Logs",
  },
  {
    icon: "∿",
    label: "Traces",
    href: "/traces",
    kicker: "⊙ DISTRIBUTED TRACES",
    title: "Traces",
  },
  {
    icon: "◫",
    label: "Dashboards",
    href: "/dashboards",
    kicker: "⊙ METRICS OVERVIEW",
    title: "Dashboards",
  },
  {
    icon: "⚙",
    label: "Settings",
    href: "/settings",
    kicker: "⊙ WORKSPACE CONFIG",
    title: "Settings",
  },
];

export function getNavItem(pathname: string) {
  return EVOLVEX_APP_NAV.find((item) => pathname.startsWith(item.href)) ?? EVOLVEX_APP_NAV[0]!;
}
