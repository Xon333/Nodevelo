import type { Metadata } from "next";
import KnowledgeBaseEditor from "@/components/KnowledgeBaseEditor";

export const metadata: Metadata = { title: "Knowledge — NodeVelo" };

export default function KnowledgePage() {
  return <KnowledgeBaseEditor />;
}
