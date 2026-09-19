import Link from "next/link";
import { Card } from "./Card";
import { cn } from "@/lib/cn";
import type { ComponentType, SVGProps } from "react";

interface LandingSectionCardProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  name: string;
  description: string;
  href?: string;
  comingSoon?: boolean;
}

/** One of the 3 home page cards: icon + section name + one-line description. */
export function LandingSectionCard({ icon: Icon, name, description, href, comingSoon }: LandingSectionCardProps) {
  // w-full/h-full (not flex-1) so the card reliably fills whichever wrapper
  // it's given — a plain grid cell here, or the <Link> below for Explore.
  // Mixing flex-1 across a Link-wrapped card and a bare card produced
  // uneven widths (Explore rendered narrower than Assess/Invest).
  const content = (
    <Card
      className={cn(
        "w-full h-full flex flex-col items-start gap-3 p-6 transition-shadow",
        !comingSoon && "hover:shadow-lg cursor-pointer",
        comingSoon && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between w-full">
        <Icon className="w-6 h-6 text-piltri-amber" />
        {comingSoon && (
          <span className="text-[10px] uppercase tracking-wide text-ink-500 bg-surface-muted rounded-pill px-2 py-1">
            Coming soon
          </span>
        )}
      </div>
      <h2 className="font-serif text-xl text-ink-900">{name}</h2>
      <p className="text-sm text-ink-500 leading-relaxed">{description}</p>
    </Card>
  );

  if (href && !comingSoon) {
    return (
      <Link href={href} className="w-full h-full block">
        {content}
      </Link>
    );
  }
  return content;
}
