import "./hero-headline.css";

const FEATURES = [
  { icon: "⛓", label: "Real-time Correlation" },
  { icon: "◎", label: "AI-Powered Context" },
  { icon: "⚡", label: "Blazing Fast" },
  { icon: "❍", label: "Open Source Friendly" },
];

export function HeroHeadline() {
  return (
    <div className="evolvex-hero-headline">
      <p className="evolvex-hero-headline__badge">
        <span aria-hidden>⊙</span> AI-NATIVE OBSERVABILITY
      </p>

      <img
        src="/images/hero-headline.png"
        alt="Every Incident Leaves Evidence."
        className="evolvex-hero-headline__image"
      />

      <p className="evolvex-hero-headline__sub">
        Evolvex automatically collects, connects and reconstructs
        <br />
        the full story behind incidents across your stack.
      </p>

      <div className="evolvex-hero-headline__ctas">
        <a href="/signin" className="evolvex-hero-headline__primary">
          Start Investigating →
        </a>
        <a href="#how-it-works" className="evolvex-hero-headline__secondary">
          See it in Action
          <span className="evolvex-hero-headline__play" aria-hidden>
            ▶
          </span>
        </a>
      </div>

      <div className="evolvex-hero-headline__features">
        {FEATURES.map((f) => (
          <span key={f.label} className="evolvex-hero-headline__feature">
            <span aria-hidden>{f.icon}</span> {f.label}
          </span>
        ))}
      </div>
    </div>
  );
}
