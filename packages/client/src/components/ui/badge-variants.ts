import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        success:
          "border-transparent bg-emerald-600 text-white hover:bg-emerald-600/80 dark:bg-emerald-500 dark:hover:bg-emerald-500/80",
        destructive:
          "border-transparent bg-destructive text-white hover:bg-destructive/80 dark:border-destructive/40 dark:bg-destructive/20 dark:text-red-200 dark:hover:bg-destructive/30",
        outline: "text-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
