import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-pill font-sans font-medium transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-piltri-amber focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variant === "primary" &&
            "bg-piltri-amber text-white hover:bg-piltri-amber-dark",
          variant === "secondary" &&
            "bg-surface-muted text-ink-900 border border-surface-border hover:bg-ink-100",
          variant === "ghost" && "bg-transparent text-ink-700 hover:bg-surface-muted",
          size === "sm" && "px-4 py-1.5 text-sm",
          size === "md" && "px-6 py-2.5 text-sm",
          size === "lg" && "px-8 py-3 text-base",
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
