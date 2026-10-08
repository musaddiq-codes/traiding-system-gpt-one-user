import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "../../components/navigation/Sidebar";
import Header from "../../components/navigation/Header";
import type { Strategy } from "../../lib/trading-types";

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const backendUrl = (
    process.env.BACKEND_URL ?? "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
  const response = await fetch(
    `${backendUrl}/api/strategies/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok) {
    throw new Error(`Unable to load strategy from backend (${response.status}).`);
  }
  const payload = await response.json() as { strategy: Strategy };
  const strategy = payload.strategy;

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1200px] px-5 py-6 lg:px-7">
          <Link
            href="/strategies"
            className="mb-6 inline-flex text-xs text-slate-600 hover:text-blue-400"
          >
            ← Back to strategies
          </Link>

          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                Strategy configuration
              </p>

              <h1 className="text-2xl font-bold tracking-tight">
                {strategy.name}
              </h1>

              <p className="mt-1 text-xs text-slate-600">
                Configure execution logic, risk and market parameters.
              </p>
            </div>

            <div className="flex gap-2">
              <button className="rounded-lg border border-[#27303d] px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white">
                Duplicate
              </button>

              <button className="rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-[#041008] hover:bg-emerald-400">
                Start Strategy
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
            <div className="space-y-6">
              <section className="trading-panel">
                <div className="border-b border-[#1b2330] px-5 py-4">
                  <h2 className="text-sm font-semibold">
                    Strategy Parameters
                  </h2>
                </div>

                <div className="grid gap-5 p-5 sm:grid-cols-2">
                  <Field label="Trading Pair" value={strategy.symbol} />
                  <Field label="Timeframe" value={strategy.timeframe} />
                  <Field label="Entry Condition" value={strategy.entryCondition} />
                  <Field label="Exit Condition" value={strategy.exitCondition} />
                  <Field label="Risk / Trade" value={`${strategy.riskPerTrade}%`} />
                  <Field label="Position Size" value={strategy.positionSize.toLocaleString()} />
                  <Field label="Stop Loss" value={`${strategy.stopLoss}%`} />
                  <Field label="Take Profit" value={`${strategy.takeProfit}%`} />
                </div>
              </section>

              <section className="trading-panel">
                <div className="border-b border-[#1b2330] px-5 py-4">
                  <h2 className="text-sm font-semibold">
                    Strategy Logic
                  </h2>

                  <p className="mt-1 text-xs text-slate-600">
                    Signal conditions used by the strategy engine.
                  </p>
                </div>

                <div className="p-5">
                  <div className="rounded-xl border border-[#1b2330] bg-[#080b10] p-4 font-mono text-[11px] leading-7 text-slate-500">
                    <div>
                      <span className="text-purple-400">IF</span>{" "}
                      RSI &lt; 30
                    </div>

                    <div>
                      <span className="text-purple-400">AND</span>{" "}
                      MACD crosses above signal
                    </div>

                    <div>
                      <span className="text-purple-400">AND</span>{" "}
                      confidence &gt; 72%
                    </div>

                    <div className="mt-2 text-emerald-400">
                      → EXECUTE BUY
                    </div>

                    <div className="mt-2">
                      <span className="text-purple-400">IF</span>{" "}
                      RSI &gt; 70
                    </div>

                    <div>
                      <span className="text-purple-400">OR</span>{" "}
                      stop_loss triggered
                    </div>

                    <div className="mt-2 text-red-400">
                      → EXECUTE SELL
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="trading-panel p-5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Performance
                </div>

                <div className="number mt-3 text-3xl font-bold text-emerald-400">
                  +18.42%
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Total return
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Stat label="Win Rate" value="76.1%" />
                  <Stat label="Trades" value="142" />
                  <Stat label="Profit Factor" value="2.18" />
                  <Stat label="Max DD" value="4.72%" />
                </div>
              </section>

              <section className="trading-panel p-5">
                <div className="text-sm font-semibold">
                  Strategy Status
                </div>

                <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-500/5 p-3">
                  <span className="text-xs text-slate-400">
                    Execution engine
                  </span>

                  <span className={`text-xs font-semibold ${
                    strategy.status === "ACTIVE"
                      ? "text-emerald-400"
                      : "text-slate-500"
                  }`}>
                  {strategy.status}
                  </span>
                </div>

                <button className="mt-4 w-full rounded-lg border border-red-500/20 bg-red-500/5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10">
                  Stop Strategy
                </button>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </label>

      <input
        defaultValue={value}
        className="w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3.5 py-3 text-xs text-slate-300 outline-none transition focus:border-blue-500/50"
      />
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-[#090c11] p-3">
      <div className="text-[9px] text-slate-700">{label}</div>
      <div className="number mt-1 text-xs font-semibold">
        {value}
      </div>
    </div>
  );
}
