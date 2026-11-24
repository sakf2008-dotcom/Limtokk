// Cloudflare Worker entry. OpenNext builds the application into .open-next/worker.js, which only exports
// fetch. This file adds the scheduled (cron) handler. The daily retention job runs through the same
// authenticated route that Vercel Cron uses, so the cleanup logic lives in one place.
import worker from "./.open-next/worker.js";

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    const request = new Request("https://scheduled.invalid/api/cron/cleanup", {
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });
    ctx.waitUntil(
      worker.fetch(request, env, ctx).then(
        (response) => console.log(`cleanup finished with HTTP ${response.status}`),
        (error) => console.error("cleanup failed", String(error?.message || error).slice(0, 200)),
      ),
    );
  },
};
