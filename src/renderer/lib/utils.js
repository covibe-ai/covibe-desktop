import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with proper conflict resolution.
 * Combines clsx and tailwind-merge for clean class composition.
 *
 * @param  {...import("clsx").ClassValue} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
