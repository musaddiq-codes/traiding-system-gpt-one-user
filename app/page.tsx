import Link from "next/link";

const markets = [
  {
    symbol: "BTC/USDT",
    name: "Bitcoin",
    price: "$67,842.20",
    change: "+2.84%",
    positive: true,
  },
  {
    symbol: "ETH/USDT",
    name: "Ethereum",
    price: "$3,742.18",
    change: "+1.92%",
    positive: true,
  },
  {
    symbol: "SOL/USDT",
    name: "Solana",
    price: "$181.46",
    change: "-0.74%",
    positive: false,
  },
];

const stats = [
  {
    label: "Portfolio Value",
    value: "$124,892.64",
    change: "+$8,421.28",
    percentage: "+7.23%",
  },
  {
    label: "Today's P&L",
    value: "+$1,842.73",
    change: "Today",
    percentage: "+2.61%",
  },
  {
    label: "Available Balance",
    value: "$48,216.90",
    change: "USDT",
    percentage: "38.61%",
  },
  {
    label: "Win Rate",
    value: "72.4%",
    change: "Last 30 days",
    percentage: "+4.8%",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      {/* Top navigation */}
      <header className="sticky top-0 z-50 border-b border-[#1b2330] bg-[#07090d]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/20">
              <span className="text-sm font-black">N</span>
            </div>

            <div>
              <div className="text-sm font-bold tracking-tight">
                NEXUS
              </div>
              <div className="text-[9px] font-semibold tracking-[0.2em] text-slate-500">
                TRADING TERMINAL
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            <Link
              href="/dashboard"
              className="rounded-lg bg-[#111722] px-4 py-2 text-sm font-medium text-white"
            >
              Dashboard
            </Link>

            <Link
              href="/positions"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 transition hover:bg-[#111722] hover:text-white"
            >
              Positions
            </Link>

            <Link
              href="/trades"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 transition hover:bg-[#111722] hover:text-white"
            >
              Trades
            </Link>

            <Link
              href="/strategies"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 transition hover:bg-[#111722] hover:text-white"
            >
              Strategies
            </Link>

            <Link
              href="/settings"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 transition hover:bg-[#111722] hover:text-white"
            >
              Settings
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1.5 sm:flex">
              <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">
                System Online
              </span>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#27303d] bg-[#111722] text-xs font-bold">
              M
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-8">
        {/* Hero */}
        <section className="mb-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
                Portfolio overview
              </p>

              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                Trading Dashboard
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                Monitor your portfolio, markets and automated strategies.
              </p>
            </div>

            <div className="flex gap-2">
              <button className="rounded-lg border border-[#27303d] bg-[#0d1118] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-[#394454] hover:text-white">
                Export
              </button>

              <button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-500">
                + New Trade
              </button>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="trading-panel trading-panel-hover p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {stat.label}
                </span>

                <span className="h-2 w-2 rounded-full bg-blue-500/70" />
              </div>

              <div className="number mt-4 text-2xl font-bold tracking-tight">
                {stat.value}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-medium text-emerald-400">
                  {stat.percentage}
                </span>

                <span className="text-xs text-slate-600">
                  {stat.change}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* Market ticker */}
        <section className="mb-6 overflow-hidden rounded-xl border border-[#1b2330] bg-[#0d1118]">
          <div className="flex min-w-max">
            {markets.map((market) => (
              <div
                key={market.symbol}
                className="flex min-w-[250px] flex-1 items-center justify-between border-r border-[#1b2330] px-5 py-4 last:border-r-0"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {market.symbol}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    {market.name}
                  </div>
                </div>

                <div className="text-right">
                  <div className="number text-sm font-semibold">
                    {market.price}
                  </div>
                  <div
                    className={`mt-0.5 text-xs font-medium ${
                      market.positive
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {market.change}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Main content */}
        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          {/* Chart */}
          <div className="trading-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1b2330] px-5 py-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold">BTC / USDT</h2>
                  <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-400">
                    +2.84%
                  </span>
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Binance · Spot
                </div>
              </div>

              <div className="flex gap-1 rounded-lg bg-[#080b10] p-1">
                {["1H", "4H", "1D", "1W"].map((timeframe, index) => (
                  <button
                    key={timeframe}
                    className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${
                      index === 1
                        ? "bg-[#1b2330] text-white"
                        : "text-slate-600 hover:text-slate-300"
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-grid relative h-[400px] overflow-hidden p-6">
              <div className="absolute right-4 top-10 text-[10px] text-slate-600">
                68,500
              </div>

              <div className="absolute right-4 top-1/3 text-[10px] text-slate-600">
                68,000
              </div>

              <div className="absolute right-4 top-1/2 text-[10px] text-slate-600">
                67,500
              </div>

              <div className="absolute right-4 bottom-1/4 text-[10px] text-slate-600">
                67,000
              </div>

              <svg
                viewBox="0 0 1000 360"
                className="absolute inset-6 h-[calc(100%-48px)] w-[calc(100%-48px)]"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="area"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#3b82f6"
                      stopOpacity="0.18"
                    />
                    <stop
                      offset="100%"
                      stopColor="#3b82f6"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>

                <path
                  d="M0 280 C50 265, 80 285, 120 250 S190 220, 230 240 S300 180, 340 200 S410 165, 450 180 S510 140, 550 160 S610 115, 650 145 S710 95, 750 120 S810 75, 850 100 S920 50, 1000 65 L1000 360 L0 360 Z"
                  fill="url(#area)"
                />

                <path
                  d="M0 280 C50 265, 80 285, 120 250 S190 220, 230 240 S300 180, 340 200 S410 165, 450 180 S510 140, 550 160 S610 115, 650 145 S710 95, 750 120 S810 75, 850 100 S920 50, 1000 65"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              <div className="absolute bottom-4 left-6 right-16 flex justify-between text-[10px] text-slate-700">
                <span>08:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
                <span>00:00</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="trading-panel p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Quick Trade</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Execute a manual order
                </p>
              </div>

              <span className="rounded-md bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-400">
                SPOT
              </span>
            </div>

            <div className="mb-5 flex rounded-lg bg-[#080b10] p-1">
              <button className="flex-1 rounded-md bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-400">
                BUY
              </button>

              <button className="flex-1 rounded-md py-2 text-xs font-semibold text-slate-600 hover:text-red-400">
                SELL
              </button>
            </div>

            <label className="mb-2 block text-xs font-medium text-slate-500">
              Asset
            </label>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-[#1b2330] bg-[#080b10] px-3 py-3">
              <span className="text-sm font-medium">BTC / USDT</span>
              <span className="text-xs text-slate-600">BTC</span>
            </div>

            <label className="mb-2 block text-xs font-medium text-slate-500">
              Amount
            </label>

            <div className="mb-4 flex items-center rounded-lg border border-[#1b2330] bg-[#080b10] px-3 py-3">
              <input
                placeholder="0.00"
                className="number w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-700"
              />
              <span className="text-xs font-medium text-slate-600">
                USDT
              </span>
            </div>

            <div className="mb-5 flex items-center justify-between text-xs">
              <span className="text-slate-600">Available</span>
              <span className="number text-slate-400">
                $48,216.90
              </span>
            </div>

            <button className="w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-[#041008] transition hover:bg-emerald-400">
              Place Buy Order
            </button>

            <p className="mt-3 text-center text-[10px] text-slate-700">
              Market order · Estimated execution immediately
            </p>
          </div>
        </section>

        {/* Bottom panels */}
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="trading-panel">
            <div className="flex items-center justify-between border-b border-[#1b2330] px-5 py-4">
              <div>
                <h2 className="font-semibold">Open Positions</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Active portfolio exposure
                </p>
              </div>

              <Link
                href="/positions"
                className="text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                View all →
              </Link>
            </div>

            <div className="divide-y divide-[#151c26]">
              {[
                ["BTC/USDT", "0.482 BTC", "$32,710.64", "+$2,184.32"],
                ["ETH/USDT", "4.82 ETH", "$18,040.31", "+$924.16"],
                ["SOL/USDT", "38.4 SOL", "$6,968.06", "-$118.42"],
              ].map((position) => (
                <div
                  key={position[0]}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div>
                    <div className="text-sm font-semibold">
                      {position[0]}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {position[1]}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="number text-sm font-medium">
                      {position[2]}
                    </div>
                    <div
                      className={`number mt-1 text-xs font-medium ${
                        position[3].startsWith("+")
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {position[3]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="trading-panel">
            <div className="flex items-center justify-between border-b border-[#1b2330] px-5 py-4">
              <div>
                <h2 className="font-semibold">Recent Trades</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Latest executed orders
                </p>
              </div>

              <Link
                href="/trades"
                className="text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                View all →
              </Link>
            </div>

            <div className="divide-y divide-[#151c26]">
              {[
                ["BTC/USDT", "BUY", "$67,218.42", "0.12 BTC", "09:42:18"],
                ["ETH/USDT", "SELL", "$3,698.12", "1.4 ETH", "09:18:42"],
                ["SOL/USDT", "BUY", "$182.64", "12 SOL", "08:57:31"],
              ].map((trade) => (
                <div
                  key={`${trade[0]}-${trade[4]}`}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                        trade[1] === "BUY"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {trade[1]}
                    </span>

                    <div>
                      <div className="text-sm font-semibold">
                        {trade[0]}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {trade[3]}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="number text-sm font-medium">
                      {trade[2]}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-600">
                      {trade[4]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
