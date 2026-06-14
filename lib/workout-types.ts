// Workout-type colour coding per the spec: Z2/Recovery green, Threshold amber,
// VO2max/SIT red, Strength blue, Rest grey. Literal class strings so Tailwind
// can see them at build time.
import type { WorkoutType } from "./types";

export interface TypeStyle {
  badge: string; // pill badge on cards
  cell: string; // calendar day cell
  accent: string; // hex color for borders / left stripe
}

// Cyberpunk neon spectrum, cool→warm by intensity, each hue distinct:
// Recovery cyan · Z2 emerald · Strength violet · Threshold amber · VO2max orange ·
// SIT rose · Rest muted zinc. Reads as one palette but stays easy to tell apart.
export const TYPE_STYLES: Record<WorkoutType, TypeStyle> = {
  Z2: {
    badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
    cell: "bg-emerald-500",
    accent: "#10b981",
  },
  Recovery: {
    badge: "bg-cyan-100 text-cyan-800 border-cyan-300",
    cell: "bg-cyan-500",
    accent: "#06b6d4",
  },
  Threshold: {
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    cell: "bg-amber-500",
    accent: "#f59e0b",
  },
  VO2max: {
    badge: "bg-orange-100 text-orange-800 border-orange-300",
    cell: "bg-orange-500",
    accent: "#f97316",
  },
  SIT: {
    badge: "bg-rose-100 text-rose-800 border-rose-300",
    cell: "bg-rose-500",
    accent: "#f43f5e",
  },
  Strength: {
    badge: "bg-violet-100 text-violet-800 border-violet-300",
    cell: "bg-violet-500",
    accent: "#8b5cf6",
  },
  Rest: {
    badge: "bg-zinc-100 text-zinc-600 border-zinc-300",
    cell: "bg-zinc-300",
    accent: "#a1a1aa",
  },
};
