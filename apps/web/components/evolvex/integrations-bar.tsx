import { Reveal } from "./reveal";
import "./integrations-bar.css";

const SOURCES = [
  { icon: "⑂", name: "GitHub", sub: "Code Changes" },
  { icon: "⎈", name: "Kubernetes", sub: "Clusters" },
  { icon: "◫", name: "Docker", sub: "Containers" },
  { icon: "☁", name: "AWS", sub: "Cloud Services" },
  { icon: "∿", name: "OpenTelemetry", sub: "Traces & Metrics" },
];

const OUTCOMES = [
  { icon: "◎", name: "Unified Timeline", sub: "Everything in context. One complete story." },
  { icon: "☈", name: "AI Root Cause", sub: "Find the real cause, not just symptoms." },
  { icon: "⚡", name: "Blazing Fast", sub: "Investigate in minutes, not hours." },
  { icon: "⛨", name: "Take Action", sub: "Fix issues, improve systems. Prevent future incidents." },
];

function ArrowsDown({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      className={`evolvex-integrations__arrows ${flip ? "is-flip" : ""}`}
      viewBox="0 0 900 90"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <g stroke="#f0f0eb" strokeWidth="2.5" strokeLinecap="round" opacity="0.85">
        <path d="M110 8 C 150 55, 290 70, 390 80" />
        <path d="M385 84 l 12 -7 M385 84 l 2 -13" />
        <path d="M310 8 C 330 40, 390 62, 425 74" />
        <path d="M420 78 l 12 -5 M420 78 l 3 -12" />
        <path d="M590 8 C 570 40, 510 62, 475 74" />
        <path d="M480 78 l -12 -5 M480 78 l -3 -12" />
        <path d="M790 8 C 750 55, 610 70, 510 80" />
        <path d="M515 84 l -12 -7 M515 84 l -2 -13" />
      </g>
    </svg>
  );
}

export function IntegrationsBar() {
  return (
    <section className="evolvex-integrations" id="integrations">
      <img
        src="/images/integrations-bg.png"
        alt=""
        aria-hidden
        className="evolvex-integrations__bg"
      />

      <div className="evolvex-integrations__inner">
        <Reveal>
          <p className="evolvex-integrations__badge">BUILT FOR MODERN STACKS</p>
        </Reveal>

        <Reveal delay={80}>
          <h2 className="evolvex-integrations__headline">
            <span className="evolvex-integrations__headline-white">ONE INVESTIGATION LAYER.</span>
            <span className="evolvex-integrations__headline-yellow">ALL YOUR SIGNALS.</span>
          </h2>
        </Reveal>

        <Reveal delay={140}>
          <p className="evolvex-integrations__sub">
            Evolvex connects the dots across your entire stack
            <br />
            to help you find the root cause, <em>10x faster</em>.
          </p>
        </Reveal>

        <div className="evolvex-integrations__row evolvex-integrations__row--sources">
          {SOURCES.map((s, i) => (
            <Reveal key={s.name} delay={180 + i * 90}>
              <article className="evolvex-integrations__card">
                <span className="evolvex-integrations__card-icon" aria-hidden>
                  {s.icon}
                </span>
                <span className="evolvex-integrations__card-body">
                  <span className="evolvex-integrations__card-name">{s.name}</span>
                  <span className="evolvex-integrations__card-sub">{s.sub}</span>
                </span>
              </article>
            </Reveal>
          ))}
        </div>

        <div className="evolvex-integrations__funnel">
          <ArrowsDown />

          <Reveal delay={260}>
            <div className="evolvex-integrations__brand">
              <span className="evolvex-integrations__brand-word">
                EVOLVE<span>X</span>
              </span>
              <span className="evolvex-integrations__brand-badge">AI-POWERED INVESTIGATION LAYER</span>
            </div>
          </Reveal>

          <ArrowsDown flip />
        </div>

        <div className="evolvex-integrations__row evolvex-integrations__row--outcomes">
          {OUTCOMES.map((o, i) => (
            <Reveal key={o.name} delay={320 + i * 90}>
              <article className="evolvex-integrations__card evolvex-integrations__card--outcome">
                <span className="evolvex-integrations__card-icon is-yellow" aria-hidden>
                  {o.icon}
                </span>
                <span className="evolvex-integrations__card-body">
                  <span className="evolvex-integrations__card-name">{o.name}</span>
                  <span className="evolvex-integrations__card-sub">{o.sub}</span>
                </span>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
