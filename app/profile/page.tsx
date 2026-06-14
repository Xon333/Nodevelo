import type { Metadata } from "next";
import AthleteProfileForm from "@/components/AthleteProfileForm";

export const metadata: Metadata = { title: "Athlete Profile — NodeVelo" };

export default function ProfilePage() {
  return <AthleteProfileForm />;
}
