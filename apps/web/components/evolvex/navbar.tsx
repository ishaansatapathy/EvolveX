"use client";

import Link from "next/link";

import { useEvolvexUser } from "~/hooks/use-evolvex-user";
import "./navbar.css";

function CrownIcon() {
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M1.5 11L2.3 4.2L5.3 7.6L8 2L10.7 7.6L13.7 4.2L14.5 11H1.5Z"
        stroke="#f0f0eb"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_LINKS = [
  { label: "Product", href: "#integrations" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "#features" },
  { label: "About", href: "#pricing" },
];

export function Navbar() {
  const { data: user, isLoading } = useEvolvexUser();
  const appHref = user ? "/investigations" : "/signin";
  const ctaLabel = user ? "Open App →" : "Get Started →";

  return (
    <nav className="evolvex-navbar flex items-center justify-between gap-4 px-6 py-5 md:px-10">
      <Link href="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
        <CrownIcon />
        <span className="evolvex-navbar__logo font-(family-name:--font-evolvex-hero) text-xl font-bold tracking-tight">
          <span className="evolvex-navbar__logo-evolve">EVOLVE</span>
          <span className="evolvex-navbar__logo-x">X</span>
        </span>
      </Link>

      <div className="evolvex-navbar__links hidden items-center gap-7 text-sm font-medium lg:flex">
        {NAV_LINKS.map((link) => (
          <a key={link.label} href={link.href} className="evolvex-navbar__link">
            {link.label}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-6">
        {!isLoading && user ? (
          <Link href="/investigations" className="evolvex-navbar__link text-sm font-medium">
            Dashboard
          </Link>
        ) : (
          <Link href="/signin" className="evolvex-navbar__link text-sm font-medium">
            Sign in
          </Link>
        )}
        <Link href={appHref} className="evolvex-navbar__get-started whitespace-nowrap px-5 py-2.5 text-sm font-semibold">
          {ctaLabel}
        </Link>
      </div>
    </nav>
  );
}
