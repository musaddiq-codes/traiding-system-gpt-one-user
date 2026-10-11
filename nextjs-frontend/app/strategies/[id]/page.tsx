import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "../../components/navigation/Sidebar";
import Header from "../../components/navigation/Header";
import type { Strategy } from "../../lib/trading-types";
import type { PluginManifest } from "../../lib/backend";

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
  let pluginName: string | undefined;
  if (strategy.algorithmId) {
    const pluginsResponse = await fetch(`${backendUrl}/api/plugins`, {
      cache: "no-store",
    });
    if (!pluginsResponse.ok) {
      throw new Error(`Unable to load strategy plugins (${pluginsResponse.status}).`);
    }
    const plugins = await pluginsResponse.json() as PluginManifest[];
    pluginName = plugins.find(
      (plugin) => plugin.id === strategy.algorithmId,
    )?.name ?? strategy.algorithmId;
  }

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
                  {strategy.algorithmId ? (
                    <Field label="Strategy Logic" value={pluginName ?? strategy.algorithmId} />
                  ) : (
                    <>
                      <Field label="Entry Condition" value={strategy.entryCondition ?? ""} />
                      <Field label="Exit Condition" value={strategy.exitCondition ?? ""} />
                    </>
                  )}
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

                <div className="space-y-2 p-5 text-xs text-slate-400">
                  {strategy.algorithmId ? (
                    <>
                      <p>{pluginName ?? strategy.algorithmId}</p>
                      {Object.entries(strategy.params ?? {}).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-4">
                          <span>{key}</span>
                          <span className="text-slate-200">{String(value)}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <p>Entry: {strategy.entryCondition}</p>
                      <p>Exit: {strategy.exitCondition}</p>
                      <p className="text-[10px] text-slate-600">
                        Only one comparison is evaluated; and/or are not supported.
                      </p>
                    </>
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-6">
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
