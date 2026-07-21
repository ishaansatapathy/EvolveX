import type { ReactNode } from "react";

import "./page-scroll.css";

export function PageScroll({ children }: { children: ReactNode }) {
  return <div className="evolvex-page-scroll">{children}</div>;
}
