/* Shared button styles (design-system pass): every action button in the app
   uses these so size, radius, focus ring and touch targets stay consistent.
   min-h-11 (44px) meets mobile touch-target guidance; pill radius throughout. */
import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-pill font-medium text-sm " +
  "min-h-11 px-5 transition-colors duration-150 select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lake focus-visible:ring-offset-2 focus-visible:ring-offset-parchment " +
  "disabled:opacity-45 disabled:pointer-events-none";

const VARIANTS = {
  primary: "bg-lake text-white hover:bg-lake-hover active:bg-lake-hover shadow-sm",
  dark: "bg-lake text-white hover:bg-lake-hover active:bg-lake-active shadow-sm",
  outline: "border border-ash text-offblack hover:bg-lake-tint hover:border-periwinkle-deep",
  ghost: "text-graphite hover:text-offblack hover:bg-lake-tint",
  danger: "border border-red-200 text-red-700 hover:bg-red-50"
} as const;

export type Variant = keyof typeof VARIANTS;

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...rest} className={`${BASE} ${VARIANTS[variant]} ${className}`} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a {...rest} className={`${BASE} ${VARIANTS[variant]} ${className}`} />;
}

/** Small dense variant for toolbars/table rows (still 32px+ tall). */
export function ButtonSmall({
  variant = "outline",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`${BASE} ${VARIANTS[variant]} !min-h-9 !px-3.5 text-xs ${className}`}
    />
  );
}
