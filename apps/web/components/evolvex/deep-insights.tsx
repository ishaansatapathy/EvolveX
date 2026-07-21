import { Reveal } from "./reveal";
import "./deep-insights.css";

const FEATURES = [
  {
    icon: "⌕",
    title: "Unified Investigation",
    desc: "Bring together logs, traces, metrics, events and code in one place.",
  },
  {
    icon: "☈",
    title: "AI-Powered Root Cause",
    desc: "Our AI analyzes patterns and pinpoints the real cause automatically.",
  },
  {
    icon: "</>",
    title: "Code & Deploy Context",
    desc: "See the exact code change or deployment that triggered the incident.",
  },
  {
    icon: "⛒",
    title: "Service Map",
    desc: "Visualize dependencies and see the blast radius in real-time.",
  },
  {
    icon: "⚡",
    title: "Blazing Fast",
    desc: "Built for high-cardinality data. Get answers in seconds, not minutes.",
  },
];

const SIGNALS = [
  { icon: "▤", name: "Logs", desc: "Structured + unstructured" },
  { icon: "∿", name: "Traces", desc: "Distributed spans" },
  { icon: "◫", name: "Metrics", desc: "Time-series signals" },
  { icon: "◎", name: "Events", desc: "Deploys + alerts" },
  { icon: "⑂", name: "Code", desc: "Commits + diffs" },
  { icon: "⎈", name: "Infra", desc: "K8s + cloud context" },
];

const HIGHLIGHTS = [
  {
    quote: "Every deploy, log, trace and metric stitched into one investigation timeline.",
    name: "Investigation Timeline",
    role: "See the full story of any incident",
  },
  {
    quote: "AI pinpoints the exact commit or config change that broke production.",
    name: "AI Root Cause",
    role: "From alert to answer in minutes",
  },
  {
    quote: "Live service map shows blast radius and failing dependencies instantly.",
    name: "Live Service Map",
    role: "Know what's hit before users do",
  },
];

export function DeepInsights() {
  return (
    <section className="evolvex-insights" id="features">
      <img src="/images/deep-insights-bg.png" alt="" aria-hidden className="evolvex-insights__bg" />

      <div className="evolvex-insights__cards">
        {FEATURES.map((feature, i) => (
          <Reveal key={feature.title} delay={i * 110} className="evolvex-insights__card-reveal">
            <article className="evolvex-insights__card">
              <span className="evolvex-insights__card-icon">{feature.icon}</span>
              <h3 className="evolvex-insights__card-title">{feature.title}</h3>
              <p className="evolvex-insights__card-desc">{feature.desc}</p>
            </article>
          </Reveal>
        ))}
      </div>

      <div className="evolvex-insights__signals">
        <Reveal>
          <p className="evolvex-insights__signals-label">ONE TIMELINE · EVERY SIGNAL</p>
        </Reveal>
        <div className="evolvex-insights__signal-row">
          {SIGNALS.map((signal, i) => (
            <Reveal key={signal.name} delay={i * 70}>
              <article className="evolvex-insights__signal">
                <span className="evolvex-insights__signal-icon" aria-hidden>
                  {signal.icon}
                </span>
                <span className="evolvex-insights__signal-body">
                  <span className="evolvex-insights__signal-name">{signal.name}</span>
                  <span className="evolvex-insights__signal-desc">{signal.desc}</span>
                </span>
              </article>
            </Reveal>
          ))}
        </div>
      </div>

      <div className="evolvex-insights__testimonials">
        {HIGHLIGHTS.map((t, i) => (
          <Reveal key={t.name} delay={i * 150} className="evolvex-insights__testimonial-reveal">
            <figure className="evolvex-insights__testimonial">
              <span className="evolvex-insights__tape" aria-hidden />
              <span className="evolvex-insights__stars" aria-hidden>
                ✦ EVOLVEX
              </span>
              <blockquote>{t.quote}</blockquote>
              <figcaption>
                <strong>{t.name}</strong>
                <span>{t.role}</span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
