import { Reveal } from "./reveal";
import "./teams-love.css";

const STATS = [
  { src: "/images/stat-mttr.png", alt: "MTTR down 60% — resolve incidents faster with full context" },
  { src: "/images/stat-context.png", alt: "No more context switching — everything in one investigation view" },
  { src: "/images/stat-confidence.png", alt: "Production confidence — understand what happened and fix it for good" },
  { src: "/images/stat-productivity.png", alt: "Engineer productivity up — less time debugging, more time shipping" },
];

export function TeamsLove() {
  return (
    <section className="evolvex-teams">
      <img src="/images/teams-cta-bg.png" alt="" aria-hidden className="evolvex-teams__bg" />

      <div className="evolvex-teams__stats">
        {STATS.map((stat, i) => (
          <Reveal key={stat.src} delay={i * 130} className="evolvex-teams__stat-reveal">
            <img src={stat.src} alt={stat.alt} className="evolvex-teams__stat" />
          </Reveal>
        ))}
      </div>

      <a href="/signin" className="evolvex-teams__cta" aria-label="Start investigating for free">
        <span className="evolvex-teams__cta-label">Start Investigating for Free →</span>
      </a>

      {/* hide baked-in "EVO LEX" on spray can label — no crown, just blends with can */}
      <span className="evolvex-teams__can-cover" aria-hidden />

      <figure className="evolvex-teams__product-card">
        <span className="evolvex-teams__product-quote" aria-hidden>
          “
        </span>
        <blockquote>
          Evolvex reconstructs the full incident story — deploys, logs, traces and metrics correlated
          automatically.
        </blockquote>
        <figcaption>
          <strong>— EVOLVEX</strong>
          <span>AI-native observability</span>
        </figcaption>
      </figure>
    </section>
  );
}
