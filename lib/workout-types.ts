// Workout-type colour coding per the spec: Z2/Recovery green, Threshold amber,
// VO2max/SIT red, Strength blue, Rest grey. Literal class strings so Tailwind
// can see them at build time.
import type { WorkoutType } from "./types";

export interface TypeStyle {
  badge: string; // pill badge on cards
  cell: string; // calendar day cell
}

export const TYPE_STYLES: Record<WorkoutType, TypeStyle> = {
  Z2: {
    badge: "bg-green-100 text-green-800 border-green-300",
    cell: "bg-green-500",
  },
  Recovery: {
    badge: "bg-emerald-100 text-emerald-700 border-emerald-300",
    cell: "bg-emerald-400",
  },
  Threshold: {
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    cell: "bg-amber-500",
  },
  VO2max: {
    badge: "bg-red-100 text-red-800 border-red-300",
    cell: "bg-red-500",
  },
  SIT: {
    badge: "bg-red-200 text-red-900 border-red-400",
    cell: "bg-red-600",
  },
  Strength: {
    badge: "bg-blue-100 text-blue-800 border-blue-300",
    cell: "bg-blue-500",
  },
  Rest: {
    badge: "bg-gray-100 text-gray-600 border-gray-300",
    cell: "bg-gray-300",
  },
};
