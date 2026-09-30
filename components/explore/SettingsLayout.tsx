import type { ReactNode } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { cn } from "@/lib/cn";

/** The shared frame of Settings and Score settings (2026-09-30, on
 *  request: "improve overall coherence"): the Back link and title at the
 *  top, then one white card per group of settings, all in one 576px
 *  column. */
export function SettingsLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />
      <div className="px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <div className="max-w-xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl text-ink-900 mt-2">{title}</h1>
          <div className="mt-8 space-y-5">{children}</div>
        </div>
      </div>
    </main>
  );
}

/** One group of settings: a small heading, then its rows. `footer` sits
 *  under a divider at the bottom (e.g. Score settings' reset). */
export function SettingsSection({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-card bg-surface border border-surface-border">
      <div className="px-5 sm:px-6 pt-5 pb-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{title}</h2>
        <div className="mt-2 divide-y divide-surface-border">{children}</div>
      </div>
      {footer && <div className="px-5 sm:px-6 py-3 border-t border-surface-border">{footer}</div>}
    </section>
  );
}

/** Label on the left, its control on the right, the same height in every
 *  group. `labelWidth` fixes the label column where controls must line up
 *  (the weight sliders); otherwise it takes what it needs. */
export function SettingRow({
  label,
  htmlFor,
  labelWidth,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelWidth?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-3 min-h-[3.25rem]">
      <label htmlFor={htmlFor} className={cn("text-sm text-ink-700 flex-shrink-0 whitespace-nowrap", labelWidth)}>
        {label}
      </label>
      <div className="flex-1 min-w-0 flex items-center justify-end gap-3">{children}</div>
    </div>
  );
}

/** Pick-one control (currency, units, language): equal-width options in one
 *  rounded outline, the chosen one filled. */
export function SegmentedControl<T extends string>({
  options,
  value,
  labels,
  onSelect,
}: {
  options: T[];
  value: T;
  labels: Record<T, string>;
  onSelect: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex items-center rounded-pill border border-surface-border overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={opt === value}
          onClick={() => onSelect(opt)}
          className={cn(
            "w-14 sm:w-[4.5rem] py-1.5 text-center transition-colors",
            opt === value ? "bg-piltri-amber text-white" : "bg-surface text-ink-500 hover:bg-surface-muted"
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}
