import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { answerQuestion } from "@/lib/qa";
import { audit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Body = z.object({ question: z.string().min(1).max(1000), session_id: z.string().optional() });

/** Q&A streams token frames, then a citations frame, then meta + done.
 *  The answer is fully computed and validated before the first token is sent,
 *  so the citation frame can never contradict the streamed text. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const result = await answerQuestion({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    contractId: ctId,
    question: parse.data.question
  });

  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "chat.ask", resourceType: "chat_message", resourceId: result.messageId,
    metadata: { answer_kind: result.answerKind, citation_count: result.citations.length }
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Guard against enqueue-after-close: when the client disconnects mid-stream
      // the controller closes; further writes must stop silently, not throw.
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Stream the answer text in small chunks (Q&A announces on completion for SR).
      const words = result.content.split(/(\s+)/);
      let i = 0;
      const pushNext = () => {
        if (closed) return;
        if (i < words.length) {
          send("token", { delta: words[i] });
          i++;
          setTimeout(pushNext, 12);
        } else {
          send("citations", { citations: result.citations });
          send("meta", {
            confidence: result.confidence,
            answer_kind: result.answerKind,
            follow_up: result.followUp,
            evidence: result.evidence
          });
          send("done", { message_id: result.messageId });
          try { controller.close(); } catch { /* already closed by disconnect */ }
        }
      };
      pushNext();
    },
    cancel() {
      // Client disconnected: the start() loop observes `closed` via send()'s guard.
    }
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" }
  });
}
