"use client";

import { useEffect, useState } from "react";

import { Reveal } from "./reveal";
import "./how-it-works.css";

const STEPS = [
  {
    num: "01",
    title: "COLLECT",
    desc: "Evolvex ingests telemetry from your entire stack in real-time.",
    icon: "▣",
  },
  {
    num: "02",
    title: "CORRELATE",
    desc: "AI connects the dots between logs, traces, metrics and events.",
    icon: "⛓",
  },
  {
    num: "03",
    title: "CONTEXTUALIZE",
    desc: "Enriches signals with code changes, deploys and ownership.",
    icon: "⌖",
  },
  {
    num: "04",
    title: "RECONSTRUCT",
    desc: "Get a full timeline and root cause with confidence.",
    icon: "✦",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || paused) return;
    const id = setInterval(() => {
      setActive((a) => (a + 1) % STEPS.length);
    }, 2800);
    return () => clearInterval(id);
  }, [mounted, paused]);

  return (
    <section className="evolvex-how" id="how-it-works">
      <img src="/images/how-it-works-bg.png" alt="" aria-hidden className="evolvex-how__bg" />

      <div className="evolvex-how__inner">
        <Reveal>
          <h2 className="evolvex-how__title">
            <span className="evolvex-how__title-mark">HOW IT WORKS</span>
          </h2>
        </Reveal>

        <div className="evolvex-how__grid">
          <div
            className="evolvex-how__steps"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 120}>
                <button
                  type="button"
                  suppressHydrationWarning
                  className={`evolvex-how__step ${mounted && active === i ? "is-active" : ""}`}
                  onClick={() => setActive(i)}
                >
                  <span className="evolvex-how__step-icon">{step.icon}</span>
                  <span className="evolvex-how__step-body">
                    <span className="evolvex-how__step-title">{step.title}</span>
                    <span className="evolvex-how__step-desc">{step.desc}</span>
                  </span>
                  <span className="evolvex-how__step-num">{step.num}</span>
                </button>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200} className="evolvex-how__panel-reveal">
            <div className="evolvex-how__panel">
              <img
                src="/images/dashboard-panels.png"
                alt="Evolvex investigation dashboard showing timeline, service map, root cause and error rate"
                className="evolvex-how__dashboard"
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
