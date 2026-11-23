import type { Metadata } from "next";
import { LearnClient } from "@/components/library/LearnClient";

export const metadata: Metadata = { title: "مركز التعلّم" };

export default function LearnPage() {
  return <LearnClient />;
}
