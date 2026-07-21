import { Reveal } from "./reveal";
import "./pricing-footer.css";

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "/mo",
    desc: "For individuals and hobby projects.",
    features: ["Up to 3 data sources", "7-day data retention", "Community support"],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "/mo",
    desc: "For growing teams and production apps.",
    features: ["Unlimited data sources", "30-day data retention", "AI root cause", "Priority support"],
    cta: "Start Free Trial",
    highlight: true,
  },
  {
    name: "Team",
    price: "$79",
    period: "/mo",
    desc: "For teams that need more power and control.",
    features: ["Everything in Pro", "90-day data retention", "SSO & RBAC", "Team dashboards"],
    cta: "Start Free Trial",
    highlight: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large organizations with advanced needs.",
    features: ["Everything in Team", "Custom retention", "Dedicated support", "On-prem / VPC options"],
    cta: "Contact Sales",
    highlight: false,
  },
];

const ARTICLES = [
  { title: "How to reduce MTTR with full context", date: "Jul 12, 2026" },
  { title: "AI in Observability: hype or helper?", date: "Jul 5, 2026" },
  { title: "5 signals every team should monitor", date: "Jun 28, 2026" },
  { title: "Building a better incident workflow", date: "Jun 20, 2026" },
  { title: "Observability for microservices", date: "Jun 14, 2026" },
];

const FOOTER_LINKS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Docs", href: "#features" },
      { label: "Changelog", href: "#features" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", href: "#pricing" },
      { label: "Guides", href: "#how-it-works" },
      { label: "API", href: "#integrations" },
      { label: "Status", href: "#integrations" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#features" },
      { label: "Careers", href: "#pricing" },
      { label: "Contact", href: "/signin" },
    ],
  },
];

export function PricingFooter() {
  return (
    <section className="evolvex-pricing" id="pricing">
      <img src="/images/pricing-footer-bg.png" alt="" aria-hidden className="evolvex-pricing__bg" />

      <div className="evolvex-pricing__plans">
        {PLANS.map((plan, i) => (
          <Reveal key={plan.name} delay={i * 120} className="evolvex-pricing__plan-reveal">
            <article className={`evolvex-pricing__plan ${plan.highlight ? "is-highlight" : ""}`}>
              {plan.highlight ? <span className="evolvex-pricing__badge">MOST POPULAR</span> : null}
              <h3 className="evolvex-pricing__plan-name">{plan.name}</h3>
              <p className="evolvex-pricing__plan-price">
                {plan.price}
                {plan.period ? <span>{plan.period}</span> : null}
              </p>
              <p className="evolvex-pricing__plan-desc">{plan.desc}</p>
              <ul className="evolvex-pricing__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <span aria-hidden>✓</span> {f}
                  </li>
                ))}
              </ul>
              <a href="/signin" className="evolvex-pricing__cta">
                {plan.cta}
              </a>
            </article>
          </Reveal>
        ))}
      </div>

      <div className="evolvex-pricing__articles">
        {ARTICLES.map((article, i) => (
          <Reveal key={article.title} delay={i * 90} className="evolvex-pricing__article-reveal">
            <a href="#" className="evolvex-pricing__article">
              <span className="evolvex-pricing__article-title">{article.title}</span>
              <span className="evolvex-pricing__article-date">{article.date} →</span>
            </a>
          </Reveal>
        ))}
      </div>

      <div className="evolvex-pricing__footer">
        {FOOTER_LINKS.map((col) => (
          <div key={col.heading} className="evolvex-pricing__footer-col">
            <p className="evolvex-pricing__footer-heading">{col.heading}</p>
            {col.links.map((link) => (
              <a key={link.label} href={link.href} className="evolvex-pricing__footer-link">
                {link.label}
              </a>
            ))}
          </div>
        ))}

        <div className="evolvex-pricing__footer-col evolvex-pricing__newsletter">
          <p className="evolvex-pricing__footer-heading">Stay in the loop</p>
          <p className="evolvex-pricing__newsletter-sub">Get updates, tips and war stories.</p>
          <form className="evolvex-pricing__newsletter-form">
            <input type="email" suppressHydrationWarning placeholder="Enter your email" aria-label="Email address" />
            <button type="submit" suppressHydrationWarning aria-label="Subscribe">
              GO
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
