import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { llm } from "./ports";
import { SHARED_PREAMBLE, PROMPT_VERSIONS } from "./ai/prompts";
import { QAOutput, type QAOutputT } from "./ai/schemas";
import { hybridRetrieve, routeIntent, type EvidenceChunk } from "./retrieval";
import { resolveAndStoreCitation, bannedPhraseLint, CITATION_THRESHOLD } from "./validator";
import { diceSimilarity } from "./similarity";
import { id } from "./ids";
import { addDays, toISODate } from "./dates";

export interface QAResult {
  answerKind: QAOutputT["answer_kind"];
  content: string;
  citations: { id: string; page: number; sectionRef: string | null; quotedText: string }[];
  confidence: number;
  followUp: string | null;
  evidence: { chunkId: string; score: number }[];
  messageId: string;
}

/**
 * Answer a question about a contract. Enforces all four refusal patterns:
 * silent, conflict, out-of-scope (legal advice), permission.
 */
export async function answerQuestion(opts: {
  workspaceId: string;
  userId: string;
  contractId: string;
  question: string;
}): Promise<QAResult> {
  const msgId = id("msg");

  // Authorised versions = all versions of this contract in this workspace.
  const versions = await db.execute<{ id: string }>(sql`
    SELECT id FROM document_versions
    WHERE contract_id = ${opts.contractId} AND workspace_id = ${opts.workspaceId}
  `);
  const authorizedVersionIds = versions.rows.map((r) => r.id);

  // Permission refusal: no authorized versions → refusal_permission.
  if (authorizedVersionIds.length === 0) {
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "refusal_permission",
        content: "You do not have access to any version of this document, so I cannot answer from it.",
        citations: [], confidence: 1, followUp: null, evidence: [], messageId: msgId
      }
    });
  }

  /* ── Legal-advice / legal-authority intent → out-of-scope refusal ───── */
  const advicePats = [
    /enforceab|legally binding|legal (advice|opinion|conclusion)|should (i|we) (sue|terminate|cancel)|is this (legal|compliant)|what (does )?the law (say|require)|can you advise|liable/i,
    /\b(U\.S\.C|statute|case law|precedent)\b/i
  ];
  if (advicePats.some((re) => re.test(opts.question))) {
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "refusal_out_of_scope",
        content: "That asks for a legal conclusion, which is outside what this tool can answer. I can show you exactly what the contract says on a topic — for example governing law, termination, or liability — and you can take that to qualified counsel for advice.",
        citations: [], confidence: 1, followUp: "Do you want me to show what the contract says about governing law and dispute resolution instead?", evidence: [], messageId: msgId
      }
    });
  }

  /* ── Portfolio/date intent → SQL over obligations, no RAG ───────────── */
  const intent = routeIntent(opts.question);
  if (intent.intent === "portfolio_dates") {
    const days = intent.windowDays ?? 30;
    const today = toISODate(new Date());
    const until = addDays(today, days);
    const rows = await db.execute<{ title: string; due_date: string; contract_title: string; contract_id: string }>(sql`
      SELECT o.title, o.due_date, c.title AS contract_title, c.id AS contract_id
      FROM obligations o JOIN contracts c ON c.id = o.contract_id
      WHERE o.workspace_id = ${opts.workspaceId}
        AND o.status IN ('active','overdue')
        AND o.due_date BETWEEN ${today} AND ${until}
      ORDER BY o.due_date ASC LIMIT 20
    `);
    if (rows.rows.length === 0) {
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "grounded",
        content: `No obligations are due in the next ${days} days.`,
        citations: [], confidence: 0.9, followUp: null, evidence: [], messageId: msgId
      }
    });
    }
    const lines = rows.rows.map((r) => `- ${r.title} — ${r.contract_title} — due ${r.due_date} (/contracts/${r.contract_id}/obligations)`);
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "grounded",
        content: `${rows.rows.length} obligation(s) due in the next ${days} days:\n${lines.join("\n")}`,
        citations: [], confidence: 0.9, followUp: null, evidence: [], messageId: msgId
      }
    });
  }

  /* ── Document text intent → hybrid retrieval + cited answer ────────── */
  const evidence = await hybridRetrieve({
    workspaceId: opts.workspaceId,
    authorizedVersionIds,
    question: opts.question,
    topK: 8
  });

  // Below relevance threshold → refusal_silent with a follow-up.
  if (evidence.length === 0 || maxScore(evidence) < 0.005) {
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "refusal_silent",
        content: `The contract does not appear to address that. I searched the full text of all versions and found nothing relevant to "${opts.question}".`,
        citations: [], confidence: 0.85,
        followUp: "Do you want me to check a related document, like an order form or schedule?",
        evidence: evidence.map((e) => ({ chunkId: e.chunkId, score: e.score })), messageId: msgId
      }
    });
  }

  const evidenceBlock = evidence.map((e, i) =>
    `<evidence id="chk_${i}" page="${e.pageStart}" section="${e.sectionRef ?? ""}">\n${e.text}\n</evidence>`
  ).join("\n");

  const result = await llm().structured({
    system: `${SHARED_PREAMBLE}

You answer questions about a contract using ONLY the supplied evidence blocks. Every claim must reference evidence ids from the supplied set — you cannot invent ids.
If the evidence is silent on the question, answer_kind = "refusal_silent" with no claims and one focused follow-up question.
If two evidence blocks disagree, answer_kind = "refusal_conflict" and quote both.
Do not state legal conclusions or cite legal authority.
answer_kind is one of: grounded | refusal_silent | refusal_conflict | refusal_out_of_scope | refusal_permission.`,
    user: `Question: ${opts.question}

Evidence:
${evidenceBlock}

Answer with citations to the evidence ids.`,
    schema: QAOutput,
    temperature: 0.1,
    promptVersion: PROMPT_VERSIONS.qa,
    maxTokens: 2000
  });

  /* ── Claim-level citation validation (doc 04 §9) ────────────────────── */
  const validEvidenceIds = new Set(evidence.map((_, i) => `chk_${i}`));
  const validClaims = [];
  const citations: QAResult["citations"] = [];
  const seenCit = new Set<string>();

  for (const claim of result.data.claims) {
    const ids = claim.evidence_ids.filter((eid) => validEvidenceIds.has(eid));
    if (ids.length === 0) continue; // claim without valid evidence membership → dropped

    // Citation similarity check: claim text must overlap its cited span ≥ threshold.
    const idx = parseInt(ids[0].replace("chk_", ""), 10);
    const ev = evidence[idx];
    const sim = diceSimilarity(claim.text, ev.text);
    if (sim < 0.35 && !bannedPhraseLint(claim.text).clean) continue;

    if (!bannedPhraseLint(claim.text).clean) continue; // advice phrasing → drop claim

    validClaims.push(claim);
    for (const eid of ids) {
      const e = evidence[parseInt(eid.replace("chk_", ""), 10)];
      if (!e || seenCit.has(e.chunkId)) continue;
      seenCit.add(e.chunkId);
      const cit = await resolveAndStoreCitation(opts.workspaceId, e.documentVersionId, {
        page: e.pageStart,
        section_ref: e.sectionRef,
        char_start: e.charStart,
        char_end: e.charEnd,
        quoted_text: e.text.slice(0, 400)
      }, null);
      if (cit) {
        citations.push({ id: cit.id, page: cit.page, sectionRef: cit.sectionRef, quotedText: cit.quotedText });
      }
    }
  }

  if (validClaims.length === 0) {
    // Model reached beyond its evidence → honest refusal rather than a thin answer.
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: result.data.answer_kind === "refusal_conflict" ? "refusal_conflict" : "refusal_silent",
        content: result.data.answer_kind === "refusal_conflict"
          ? "Two clauses in the document conflict on this, and I cannot choose between them."
          : "I could not support an answer from the document text for that question.",
        citations: [],
        confidence: result.data.self_confidence,
        followUp: result.data.follow_up_question ?? "Do you want me to show the sections I searched?",
        evidence: evidence.map((e) => ({ chunkId: e.chunkId, score: e.score })), messageId: msgId
      }
    });
  }

  const content = validClaims.map((c) => c.text).join(" ");
  const lint = bannedPhraseLint(content);
  if (!lint.clean) {
    return finish({
      question: opts.question,
      workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
      result: {
        answerKind: "refusal_out_of_scope",
        content: "I can't answer that as phrased. I can show what the contract says on a specific topic instead.",
        citations: [], confidence: 0.9, followUp: "Try asking about a specific clause topic, like payment, termination, or liability.", evidence: [], messageId: msgId
      }
    });
  }

  return finish({
    question: opts.question,
    workspaceId: opts.workspaceId, contractId: opts.contractId, userId: opts.userId,
    result: {
      answerKind: "grounded",
      content,
      citations,
      confidence: result.data.self_confidence,
      followUp: result.data.follow_up_question,
      evidence: evidence.map((e) => ({ chunkId: e.chunkId, score: e.score })),
      messageId: msgId
    }
  });

  function maxScore(evs: EvidenceChunk[]): number {
    return evs.reduce((m, e) => Math.max(m, e.score), 0);
  }
}

async function finish(opts: {
  question: string;
  workspaceId: string; contractId: string; userId: string; result: QAResult;
}): Promise<QAResult> {
  const r = opts.result;
  let sessionId = (await db.execute<{ id: string }>(sql`
    SELECT id FROM chat_sessions WHERE contract_id = ${opts.contractId} AND created_by = ${opts.userId} ORDER BY created_at DESC LIMIT 1
  `)).rows[0]?.id;
  if (!sessionId) {
    sessionId = id("cses");
    await db.execute(sql`
      INSERT INTO chat_sessions (id, workspace_id, contract_id, scope, created_by)
      VALUES (${sessionId}, ${opts.workspaceId}, ${opts.contractId}, ${JSON.stringify({ mode: "contract" })}::jsonb, ${opts.userId})
    `);
  }
  await db.execute(sql`
    INSERT INTO chat_messages (id, workspace_id, session_id, role, content, answer_kind, confidence, citation_ids, evidence)
    VALUES (${id("msg")}, ${opts.workspaceId}, ${sessionId}, 'user', ${opts.question}, null, null, '{}', null)
  `);
  const citArray = r.citations.length > 0
    ? sql.raw(`ARRAY[${r.citations.map((c) => `'${c.id.replace(/'/g, "")}'`).join(",")}]::text[]`)
    : sql.raw(`'{}'::text[]`);
  await db.execute(sql`
    INSERT INTO chat_messages (id, workspace_id, session_id, role, content, answer_kind, confidence, citation_ids, evidence)
    VALUES (${r.messageId}, ${opts.workspaceId}, ${sessionId}, 'assistant', ${r.content}, ${r.answerKind}, ${r.confidence}, ${citArray}, ${JSON.stringify({ evidence: r.evidence })}::jsonb)
  `);
  return r;
}
