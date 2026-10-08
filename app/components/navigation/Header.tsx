"use client";

import { usePathname } from "next/navigation";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/positions": "Positions",
  "/trades": "Trades",
  "/strategies": "Strategies",
  "/backtest": "Backtest",
  "/settings": "Settings",
};

export default function Header() {
  const pathname = usePathname();

  const pageName =
    pageNames[pathname] ||
    (pathname.startsWith("/strategies/")
      ? "Strategy"
      : "Trading Terminal");

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-[#1b2330] bg-[#07090d]/85 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between px-5 lg:px-7">
        {/* Left */}
        <div className="flex items-center gap-4">
          <div className="lg:hidden">
            <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#27303d] bg-[#0d1118] text-slate-400">
              ☰
            </button>
          </div>

          <div>
            <h1 className="text-sm font-semibold text-white">
              {pageName}
            </h1>

            <div className="mt-0.5 hidden text-[10px] text-slate-600 sm:block">
              {pathname === "/dashboard"
                ? "Portfolio overview and market activity"
                : "Nexus Trading Terminal"}
            </div>
          </div>
        </div>

        {/* Center market status */}
        <div className="hidden items-center gap-5 md:flex">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">
              BTC
            </span>
            <span className="number text-xs font-medium">
              $67,842
            </span>
            <span className="text-[10px] font-medium text-emerald-400">
              +2.84%
            </span>
          </div>

          <div className="h-4 w-px bg-[#1b2330]" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">
              ETH
            </span>
            <span className="number text-xs font-medium">
              $3,742
            </span>
            <span className="text-[10px] font-medium text-emerald-400">
              +1.92%
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          <button
            title="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#1b2330] bg-[#0d1118] text-slate-500 transition hover:border-[#293443] hover:text-white"
          >
            <span className="text-sm">♢</span>
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-400" />
          </button>

          <div className="hidden h-9 items-center gap-2 rounded-lg border border-[#1b2330] bg-[#0d1118] px-3 sm:flex">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-400">
              LIVE
            </span>
          </div>

          <button className="flex h-9 items-center gap-2 rounded-lg border border-[#1b2330] bg-[#0d1118] px-2.5 transition hover:border-[#293443]">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-[10px] font-bold text-blue-400">
              M
            </span>

            <span className="hidden text-xs font-medium text-slate-300 sm:block">
              Main
            </span>

            <span className="text-[10px] text-slate-600">
              ▾
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
