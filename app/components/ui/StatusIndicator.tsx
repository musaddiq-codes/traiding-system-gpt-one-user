interface StatusIndicatorProps {
  status: "online" | "offline" | "warning" | "running" | "paused";
  label?: string;
  pulse?: boolean;
}

const statusConfig = {
  online: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Online",
  },
  running: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Running",
  },
  offline: {
    dot: "bg-red-400",
    text: "text-red-400",
    bg: "bg-red-500/10",
    label: "Offline",
  },
  warning: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Warning",
  },
  paused: {
    dot: "bg-slate-400",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    label: "Paused",
  },
};

export default function StatusIndicator({
  status,
  label,
  pulse = true,
}: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 ${config.bg}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
          pulse && (status === "online" || status === "running")
            ? "live-dot"
            : ""
        }`}
      />

      <span
        className={`text-[10px] font-semibold uppercase tracking-wide ${config.text}`}
      >
        {label || config.label}
      </span>
    </span>
  );
}
