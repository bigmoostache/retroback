import { clsx, type ClassValue } from "clsx"
import { twMerge } from "@/styles/twMerge"

/** Joins class names; later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false
  return matchMedia("(prefers-reduced-motion: reduce)").matches
}
