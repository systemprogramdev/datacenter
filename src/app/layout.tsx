import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DATACENTER // SPITr Bot Management",
  description: "Bot orchestration system for SPITr",
};

const navLinks = [
  { href: "/", label: "DASHBOARD", icon: "sys-icon-home" },
  { href: "/bots", label: "BOTS", icon: "sys-icon-user" },
  { href: "/jobs", label: "JOBS", icon: "sys-icon-clock" },
  { href: "/logs", label: "LOGS", icon: "sys-icon-file" },
  { href: "/sybil", label: "SYBIL", icon: "sys-icon-users" },
  { href: "/images", label: "IMAGES", icon: "sys-icon-image" },
  { href: "/settings", label: "SETTINGS", icon: "sys-icon-settings" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="terminal">
      <body>
        <div className="scanlines-subtle" />
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <header className="dc-header">
            <div className="dc-container flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="sys-icon sys-icon-terminal sys-icon-lg" style={{ color: "var(--sys-primary)" }} />
                <h1 className="text-glow dc-brand">DATACENTER</h1>
                <span className="dc-version">// SPITr Bot Management v0.1</span>
              </div>
              <nav className="dc-nav">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="btn btn-ghost btn-sm font-mono"
                    style={{ fontSize: "0.65rem", letterSpacing: "0.05em" }}
                  >
                    <span className={`sys-icon ${link.icon} sys-icon-sm`} />
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main style={{ flex: 1, padding: "1.25rem" }}>
            <div className="dc-container">{children}</div>
          </main>

          <footer className="dc-footer">
            <div className="dc-container flex justify-between">
              <span>DATACENTER v0.1.0 // spitr.wtf</span>
              <span>
                <span className="sys-icon sys-icon-globe sys-icon-sm" /> Ollama: localhost:11434
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
