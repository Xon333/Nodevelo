import type { Metadata } from "next";
import AthleteProfileForm from "@/components/AthleteProfileForm";

export const metadata: Metadata = { title: "Athlete Profile — Cycling Training Brain" };

export default function ProfilePage() {
  return <AthleteProfileForm />;
}
