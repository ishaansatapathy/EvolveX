"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useEvolvexUser } from "~/hooks/use-evolvex-user";
import { EVOLVEX_APP_NAV } from "~/lib/evolvex-app-nav";
import { trpc } from "~/trpc/client";

import "~/app/(app)/app-shell.css";

type AppPageHeaderProps = {
  kicker: string;
  title: string;
  children?: ReactNode;
};

export function AppPageHeader({ kicker, title, children }: AppPageHeaderProps) {
  const { data: user } = useEvolvexUser();
  const initials = user
    ? (user.displayName ?? user.fullName)
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")
    : "EV";

  return (
    <header className="evx-dash__topbar">
      <div>
        <p className="evx-dash__kicker">{kicker}</p>
        <h1 className="evx-dash__title">{title}</h1>
      </div>
      <div className="evx-dash__topbar-right">
        {children}
        <span className="evx-dash__env">PROD</span>
        <span className="evx-dash__avatar" aria-hidden title={user?.email}>
          {initials || "EV"}
        </span>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, isLoading, isError } = useEvolvexUser();
  const logoutMutation = trpc.auth.logout.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!isLoading && (isError || !user)) {
      router.replace("/signin");
    }
  }, [isLoading, isError, user, router]);

  async function handleSignOut() {
    await logoutMutation.mutateAsync({});
    await utils.auth.me.invalidate();
    router.push("/signin");
  }

  if (isLoading || !user) {
    return (
      <div className="evx-dash evx-dash--loading">
        <p>Loading case file…</p>
      </div>
    );
  }

  return (
    <div className="evx-dash">
      <aside className="evx-dash__sidebar">
        <Link href="/" className="evx-dash__logo">
          <span className="evx-dash__logo-evolve">EVOLVE</span>
          <span className="evx-dash__logo-x">X</span>
        </Link>

        <nav className="evx-dash__nav" aria-label="App navigation">
          {EVOLVEX_APP_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`evx-dash__nav-item ${active ? "is-active" : ""}`}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className="evx-dash__signout"
          onClick={handleSignOut}
          disabled={logoutMutation.isPending}
        >
          ← Sign out
        </button>
      </aside>

      <nav className="evx-dash__mobile-nav" aria-label="Mobile navigation">
        {EVOLVEX_APP_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`evx-dash__mobile-nav-item ${active ? "is-active" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="evx-dash__main">{children}</main>
    </div>
  );
}
