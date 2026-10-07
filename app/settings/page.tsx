import Sidebar from "../components/navigation/Sidebar";
import Header from "../components/navigation/Header";
import StatusIndicator from "../components/ui/StatusIndicator";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1200px] px-5 py-6 lg:px-7">
          <div className="mb-7">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
              Configuration
            </p>

            <h1 className="text-2xl font-bold tracking-tight">
              Settings
            </h1>

            <p className="mt-1 text-xs text-slate-600">
              Configure exchanges, risk controls and trading preferences.
            </p>
          </div>

          <div className="space-y-6">
            {/* Exchange */}
            <section className="trading-panel">
              <div className="border-b border-[#1b2330] px-5 py-4">
                <h2 className="text-sm font-semibold">
                  Exchange Connection
                </h2>

                <p className="mt-1 text-xs text-slate-600">
                  Manage your exchange API connection.
                </p>
              </div>

              <div className="p-5">
                <div className="flex flex-col justify-between gap-5 rounded-xl border border-[#1b2330] bg-[#090c11] p-4 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-500/10 text-lg">
                      ₿
                    </div>

                    <div>
                      <div className="text-sm font-semibold">
                        Binance
                      </div>

                      <div className="mt-1 text-xs text-slate-600">
                        Spot trading account
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <StatusIndicator
                      status="online"
                      label="Connected"
                    />

                    <button className="rounded-lg border border-[#27303d] px-3 py-2 text-xs font-medium text-slate-400 transition hover:text-white">
                      Configure
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Trading */}
            <section className="trading-panel">
              <div className="border-b border-[#1b2330] px-5 py-4">
                <h2 className="text-sm font-semibold">
                  Trading Configuration
                </h2>

                <p className="mt-1 text-xs text-slate-600">
                  Default settings for order execution.
                </p>
              </div>

              <div className="grid gap-5 p-5 md:grid-cols-2">
                <SettingField
                  label="Default Trading Pair"
                  value="BTC / USDT"
                />

                <SettingField
                  label="Order Type"
                  value="Market"
                />

                <SettingField
                  label="Default Order Size"
                  value="5% of balance"
                />

                <SettingField
                  label="Maximum Position"
                  value="20% of portfolio"
                />
              </div>
            </section>

            {/* Risk */}
            <section className="trading-panel">
              <div className="border-b border-[#1b2330] px-5 py-4">
                <h2 className="text-sm font-semibold">
                  Risk Management
                </h2>

                <p className="mt-1 text-xs text-slate-600">
                  Protect your portfolio from excessive exposure.
                </p>
              </div>

              <div className="divide-y divide-[#151c26]">
                <ToggleSetting
                  title="Stop Loss Protection"
                  description="Automatically exit positions when the configured loss threshold is reached."
                  enabled
                />

                <ToggleSetting
                  title="Take Profit"
                  description="Automatically secure profits when the configured target is reached."
                  enabled
                />

                <ToggleSetting
                  title="Daily Loss Limit"
                  description="Stop automated trading after reaching the daily loss threshold."
                  enabled
                />

                <ToggleSetting
                  title="Paper Trading"
                  description="Simulate trades without sending real orders to the exchange."
                  enabled={false}
                />
              </div>
            </section>

            {/* System */}
            <section className="trading-panel">
              <div className="border-b border-[#1b2330] px-5 py-4">
                <h2 className="text-sm font-semibold">
                  System
                </h2>

                <p className="mt-1 text-xs text-slate-600">
                  Application and connection information.
                </p>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <InfoBox label="API Status" value="Operational" />
                <InfoBox label="Latency" value="42 ms" />
                <InfoBox label="Version" value="1.0.0" />
              </div>
            </section>

            <div className="flex justify-end gap-3">
              <button className="rounded-lg border border-[#27303d] bg-[#0d1118] px-4 py-2.5 text-xs font-semibold text-slate-400 transition hover:text-white">
                Reset
              </button>

              <button className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-500">
                Save Changes
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SettingField({
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

      <button className="flex w-full items-center justify-between rounded-lg border border-[#1b2330] bg-[#090c11] px-3.5 py-3 text-left transition hover:border-[#293443]">
        <span className="text-xs font-medium text-slate-300">
          {value}
        </span>

        <span className="text-xs text-slate-700">⌄</span>
      </button>
    </div>
  );
}

function ToggleSetting({
  title,
  description,
  enabled,
}: {
  title: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-5 px-5 py-4">
      <div>
        <div className="text-xs font-semibold text-slate-300">
          {title}
        </div>

        <div className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-600">
          {description}
        </div>
      </div>

      <button
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          enabled ? "bg-blue-600" : "bg-[#27303d]"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
            enabled ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[#1b2330] bg-[#090c11] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-700">
        {label}
      </div>

      <div className="mt-2 text-sm font-semibold text-slate-300">
        {value}
      </div>
    </div>
  );
}
