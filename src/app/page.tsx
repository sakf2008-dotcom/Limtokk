import type { Metadata } from "next";
import { FeedClient } from "@/components/feed/FeedClient";

export const metadata: Metadata = {
  title: "الرئيسية",
  description: "فيديوهات تعليمية قصيرة مختارة. اسحب لتنتقل إلى الفيديو التالي.",
};

export default function HomePage() {
  return <FeedClient />;
}
