import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

const alertVariants = cva(
  "flex items-start w-full gap-2.5 rounded-md p-3 text-sm border",
  {
    variants: {
      variant: {
        info: "bg-white/5 border-white/10 text-white",
        success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-100",
        destructive: "bg-red-500/10 border-red-500/30 text-red-100",
        warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-100",
      },
    },
    defaultVariants: { variant: "info" },
  }
);

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  close?: boolean;
  onClose?: () => void;
}

function Alert({ className, variant, close, onClose, children, ...props }: AlertProps) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {children}
      {close && (
        <button onClick={onClose} aria-label="Dismiss" className="ml-auto opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-semibold", className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("opacity-80", className)} {...props} />;
}
function AlertIcon({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 mt-0.5", className)} {...props} />;
}
function AlertContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 space-y-1", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, AlertIcon, AlertContent };
