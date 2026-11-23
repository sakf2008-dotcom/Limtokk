import type { Metadata } from "next";
import { SearchClient } from "@/components/search/SearchClient";

export const metadata: Metadata = { title: "بحث" };

export default function SearchPage() {
  return <SearchClient />;
}
