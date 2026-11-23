import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata: Metadata = {
  title: "لوحة الإشراف",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminConsole />;
}
