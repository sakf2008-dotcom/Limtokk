import type { Metadata } from "next";
import { MoreClient } from "@/components/library/MoreClient";

export const metadata: Metadata = { title: "المزيد" };

export default function MorePage() {
  return <MoreClient />;
}
