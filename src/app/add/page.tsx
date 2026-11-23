import type { Metadata } from "next";
import { UploadFlow } from "@/components/upload/UploadFlow";

export const metadata: Metadata = { title: "إضافة فيديو" };

export default function AddPage() {
  return <UploadFlow />;
}
