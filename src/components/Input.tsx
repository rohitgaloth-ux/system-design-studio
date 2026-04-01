import type { AllHTMLAttributes, ElementType } from "react";

type InputProps = {
  as?: ElementType;
  className?: string;
} & AllHTMLAttributes<HTMLElement>;

export function Input({ as: Comp = "input", className = "", ...props }: InputProps) {
  return (
    <Comp
      className={`w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-950 outline-none transition-all duration-200 ease-out placeholder:text-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 ${className}`}
      {...props}
    />
  );
}
