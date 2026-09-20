"use client";

import { useState } from "react";
import { CitationChip, ConfidenceDot, SecondaryButton, Disclaimer, Badge } from "./ui";

interface Citation { id: string; page: number; section_ref: string | null; quoted_text?: string }
interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  answerKind?: string;
  followUp?: string | null;
  evidence?: { chunkId: string; score: number }[];
}

const EXAMPLES = [
  "What happens if we pay late?",
  "When can we terminate for convenience?",
  "Is the indemnity clause enforceable?"
];

export function QAView({ contractId }: { contractId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [lastMsg, setLastMsg] = useState<Message | null>(null);

  async function ask(question: string) {
    if (!question.trim() || thinking) return;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setThinking(true);
    setLastMsg(null);

    try {
      const res = await fetch(`/api/contracts/${contractId}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question })
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const assistant: Message = { role: "assistant", content: "" };
      setMessages((m) => [...m, assistant]);

      const apply = (mut: (a: Message) => Message) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = mut(copy[copy.length - 1]);
          return copy;
        });
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const evLine = frame.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!evLine || !dataLine) continue;
          const event = evLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (event === "token") apply((a) => ({ ...a, content: a.content + data.delta }));
          else if (event === "citations") apply((a) => ({ ...a, citations: data.citations }));
          else if (event === "meta") apply((a) => ({
            ...a, confidence: data.confidence, answerKind: data.answer_kind, followUp: data.follow_up, evidence: data.evidence
          }));
        }
      }
      setLastMsg(assistant);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "The answer could not be streamed. Retry the question." }]);
    } finally {
      setThinking(false);
    }
  }

  const refused = lastMsg?.answerKind?.startsWith("refusal");

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="min-h-[300px] space-y-4 mb-6" aria-live="polite">
          {messages.length === 0 && (
            <div>
              <p className="text-sm text-graphite mb-3">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((q) => (
                  <button key={q} onClick={() => ask(q)}
                    className="rounded-pill border border-ash px-4 h-9 text-xs text-offblack hover:border-periwinkle-deep">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={`rounded-panel px-5 py-4 max-w-[85%] ${m.role === "user" ? "bg-lake-tint" : m.role === "assistant" && m.answerKind?.startsWith("refusal") ? "bg-sunk border border-ash" : "panel"}`}>
                <p className="text-sm text-offblack whitespace-pre-wrap">{m.content}</p>
                {m.role === "assistant" && (
                  <>
                    {m.citations && m.citations.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {m.citations.map((c) => <CitationChip key={c.id} citation={c} />)}
                      </div>
                    )}
                    {m.followUp && (
                      <p className="text-sm text-info mt-3">{m.followUp}</p>
                    )}
                    <div className="flex items-center gap-3 mt-3">
                      {m.confidence !== undefined && <ConfidenceDot confidence={m.confidence} />}
                      {m.evidence && m.evidence.length > 0 && (
                        <button className="text-xs text-info underline" onClick={() => setShowEvidence(true)}>show sources</button>
                      )}
                      <button className="text-xs text-smoke underline" onClick={async () => {
                        await fetch(`/api/chat/messages/${m.role}/feedback`, {
                          method: "POST", headers: { "content-type": "application/json" }
                        }).catch(() => undefined);
                      }}>not helpful</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="panel px-5 py-4 text-sm text-smoke" role="status">Retrieving → Reading → Composing…</div>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this contract — answers cite the source text"
            aria-label="Your question"
            className="flex-1 border border-ash rounded-input px-4 py-2.5 text-sm bg-surface" />
          <button className="rounded-pill bg-lake text-white text-sm px-6 h-10 disabled:bg-periwinkle disabled:text-graphite"
            disabled={thinking || !input.trim()}>Ask</button>
        </form>
        <Disclaimer />
      </div>

      <aside className="hidden lg:block" aria-label="Retrieved evidence">
        <div className="panel p-5">
          <h3 className="mb-2 text-base">Evidence</h3>
          {!lastMsg?.evidence?.length && <p className="text-xs text-smoke">Retrieved chunks appear here with scores after you ask a question.</p>}
          {lastMsg?.evidence?.map((e, i) => (
            <div key={i} className="text-xs text-graphite py-2 border-b border-ash-soft last:border-0 flex justify-between">
              <span>{e.chunkId}</span>
              <span className="num">{e.score.toFixed(3)}</span>
            </div>
          ))}
          {refused && lastMsg && (
            <div className="mt-4">
              <Badge tone="neutral">{lastMsg.answerKind?.replace(/_/g, " ")}</Badge>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
