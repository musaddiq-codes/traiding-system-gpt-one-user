"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    label: "Overview",
    items: [
      {
        name: "Dashboard",
        href: "/dashboard",
        icon: "▦",
      },
    ],
  },
  {
    label: "Trading",
    items: [
      {
        name: "Positions",
        href: "/positions",
        icon: "◫",
      },
      {
        name: "Trades",
        href: "/trades",
        icon: "↕",
      },
      {
        name: "Strategies",
        href: "/strategies",
        icon: "⌁",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        name: "Settings",
        href: "/settings",
        icon: "⚙",
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[245px] border-r border-[#1b2330] bg-[#090c11] lg:block">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-[#1b2330] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/20">
              <span className="text-sm font-black text-white">
                N
              </span>
            </div>

            <div>
              <div className="text-sm font-bold tracking-tight text-white">
                NEXUS
              </div>

              <div className="text-[8px] font-semibold tracking-[0.2em] text-slate-600">
                TRADING TERMINAL
              </div>
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="mx-3 mt-4 rounded-xl border border-[#1b2330] bg-[#0d1118] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-xs font-bold text-blue-400">
              M
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">
                Main Account
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-slate-600">
                  Binance connected
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {navigation.map((section) => (
            <div key={section.label} className="mb-6">
              <div className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-700">
                {section.label}
              </div>

              <div className="space-y-1">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        group flex items-center gap-3 rounded-lg px-3 py-2.5
                        text-sm transition
                        ${
                          active
                            ? "bg-blue-500/10 text-white"
                            : "text-slate-500 hover:bg-[#111722] hover:text-slate-200"
                        }
                      `}
                    >
                      <span
                        className={`
                          flex h-5 w-5 items-center justify-center text-sm
                          ${
                            active
                              ? "text-blue-400"
                              : "text-slate-600 group-hover:text-slate-400"
                          }
                        `}
                      >
                        {item.icon}
                      </span>

                      <span className="font-medium">
                        {item.name}
                      </span>

                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom system status */}
        <div className="border-t border-[#1b2330] p-4">
          <div className="rounded-xl bg-[#0d1118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-slate-600">
                SYSTEM STATUS
              </span>

              <span className="flex items-center gap-1.5">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-semibold text-emerald-400">
                  Operational
                </span>
              </span>
            </div>

            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#18202b]">
              <div className="h-full w-[98%] rounded-full bg-emerald-500/70" />
            </div>

            <div className="mt-2 flex justify-between text-[9px] text-slate-700">
              <span>API latency</span>
              <span>42ms</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
