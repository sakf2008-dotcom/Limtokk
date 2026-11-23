import type { Metadata } from "next";
import { SavedClient } from "@/components/library/SavedClient";

export const metadata: Metadata = { title: "المحفوظات" };

export default function SavedPage() {
  return <SavedClient />;
}
