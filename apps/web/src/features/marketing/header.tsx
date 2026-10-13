"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Menu, ArrowUpRight } from "lucide-react";
import s from "./landing.module.css";

export function Wordmark() {
  return (
    <span className={s.wordmark}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 5v22M25 5 12 16l13 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
      Kivo
    </span>
  );
}
const links = [
  { href: "#product", label: "Product" },
  { href: "#agents", label: "For agents" },
  { href: "#teams", label: "For teams" },
  { href: "#faq", label: "FAQ" },
];
export function Header({
  startHref,
  loginHref,
  loginLabel,
}: {
  startHref: string;
  loginHref: string;
  loginLabel: string;
}) {
  return (
    <header className={s.header}>
      <a href="/" aria-label="Kivo home">
        <Wordmark />
      </a>
      <nav aria-label="Main navigation" className={s.desktopNav}>
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className={s.headerActions}>
        <a className={s.login} href={loginHref}>
          {loginLabel}
        </a>
        <a className={`${s.button} ${s.headerCta}`} href={startHref}>
          Get started <ArrowUpRight size={14} />
        </a>
        <Dropdown.Root>
          <Dropdown.Trigger
            className={s.menuTrigger}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className={s.mobileMenu}
              align="end"
              sideOffset={12}
            >
              {links.map((link) => (
                <Dropdown.Item asChild key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </Dropdown.Item>
              ))}
              <Dropdown.Separator className={s.menuSeparator} />
              <Dropdown.Item asChild>
                <a href={loginHref}>{loginLabel}</a>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </header>
  );
}
