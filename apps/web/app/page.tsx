import { DeepInsights } from "~/components/evolvex/deep-insights";
import { HeroHeadline } from "~/components/evolvex/hero-headline";
import { HowItWorks } from "~/components/evolvex/how-it-works";
import { IntegrationsBar } from "~/components/evolvex/integrations-bar";
import { LandingBackground } from "~/components/evolvex/landing-background";
import { Navbar } from "~/components/evolvex/navbar";
import { PageScroll } from "~/components/evolvex/page-scroll";
import { PricingFooter } from "~/components/evolvex/pricing-footer";
import { TeamsLove } from "~/components/evolvex/teams-love";

export default function Home() {
  return (
    <PageScroll>
      <LandingBackground header={<Navbar />}>
        <div className="evolvex-hero-wrap">
          <HeroHeadline />
        </div>
        <img
          src="/images/detective.png"
          alt="Detective character following the signals across traces, logs, metrics, and dependencies"
          className="evolvex-hero-illustration"
        />
      </LandingBackground>

      <IntegrationsBar />

      <HowItWorks />

      <TeamsLove />

      <DeepInsights />

      <PricingFooter />
    </PageScroll>
  );
}
