import type { Metadata } from "next";
import KnowledgeBaseEditor from "@/components/KnowledgeBaseEditor";

export const metadata: Metadata = { title: "Knowledge Base — NodeVelo" };

export default function KnowledgePage() {
  return <KnowledgeBaseEditor />;
}
