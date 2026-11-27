"use client";

/** Last-resort screen, used when even the root layout fails. It shares no styles, so it styles itself. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#07080c",
          color: "#f6f2ea",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ display: "grid", gap: 16, justifyItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>تعذّر تشغيل التطبيق</h1>
          <p style={{ margin: 0, maxWidth: 320, lineHeight: 1.8, color: "#a6acbb" }}>أعد تحميل الصفحة. إذا تكرر الخطأ، فجرّب لاحقًا.</p>
          <button
            type="button"
            onClick={reset}
            style={{ height: 44, padding: "0 20px", borderRadius: 16, border: 0, background: "#38bdf8", color: "#07080c", fontWeight: 600, cursor: "pointer" }}
          >
            حاول مرة أخرى
          </button>
        </main>
      </body>
    </html>
  );
}
