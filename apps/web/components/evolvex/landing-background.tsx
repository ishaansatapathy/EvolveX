import type { ReactNode } from "react";

import "./landing-background.css";

type LandingBackgroundProps = {
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
};

export function LandingBackground({ header, children, footer }: LandingBackgroundProps) {
  return (
    <div className="evolvex-landing">
      <img
        src="/images/landing-background.png"
        alt=""
        aria-hidden
        className="evolvex-landing__bg"
      />

      {header ? <div className="evolvex-landing__header">{header}</div> : null}

      <div className="evolvex-landing__content">{children}</div>

      {footer ? <div className="evolvex-landing__footer">{footer}</div> : null}
    </div>
  );
}
