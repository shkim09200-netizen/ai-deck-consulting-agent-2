import { NextRequest } from "next/server";
import { getJob, snapshot } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let lastVersion = -1;
      try {
        for (let ticks = 0; ; ticks++) {
          const job = getJob(id);
          if (!job) {
            send({ status: "error", error: "job not found" });
            break;
          }
          if (job.version !== lastVersion) {
            lastVersion = job.version;
            send(snapshot(job));
          } else if (ticks % 15 === 0) {
            controller.enqueue(encoder.encode(`: ping\n\n`)); // keep-alive
          }
          if (job.status !== "running") break;
          await sleep(400);
        }
      } catch {
        /* client disconnected */
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
