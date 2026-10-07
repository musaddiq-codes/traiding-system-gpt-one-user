import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}

export default function Card({
  children,
  className = "",
  title,
  description,
  action,
}: CardProps) {
  return (
    <section
      className={`trading-panel overflow-hidden ${className}`}
    >
      {(title || description || action) && (
        <div className="flex items-center justify-between border-b border-[#1b2330] px-5 py-4">
          <div>
            {title && (
              <h2 className="text-sm font-semibold text-white">
                {title}
              </h2>
            )}

            {description && (
              <p className="mt-1 text-xs text-slate-600">
                {description}
              </p>
            )}
          </div>

          {action && <div>{action}</div>}
        </div>
      )}

      {children}
    </section>
  );
}
