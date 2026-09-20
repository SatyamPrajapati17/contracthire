import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { z, ZodSchema } from "zod";

/* ═══════════════════════════ StoragePort ═══════════════════════════════
   Local ./storage folder behind a port (no S3). Write-once semantics.
   Layout: storage/w/{workspaceId}/c/{contractId}/v/{versionId}/...
   ═════════════════════════════════════════════════════════════════════ */
export interface StoragePort {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

const STORAGE_ROOT = path.join(process.cwd(), "storage");

function safeKey(key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..")) throw new Error(`unsafe storage key: ${key}`);
  return normalized;
}

export const localStorage: StoragePort = {
  async put(key, data) {
    const p = path.join(STORAGE_ROOT, safeKey(key));
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  async get(key) {
    return readFile(path.join(STORAGE_ROOT, safeKey(key)));
  },
  async exists(key) {
    try {
      await stat(path.join(STORAGE_ROOT, safeKey(key)));
      return true;
    } catch {
      return false;
    }
  },
  async delete(key) {
    try {
      await (await import("node:fs/promises")).unlink(path.join(STORAGE_ROOT, safeKey(key)));
    } catch {
      /* already gone */
    }
  },
  async list(prefix) {
    const base = path.join(STORAGE_ROOT, safeKey(prefix));
    const out: string[] = [];
    async function walk(dir: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(path.relative(STORAGE_ROOT, full).split(path.sep).join("/"));
      }
    }
    await walk(base);
    return out;
  }
};

/* DB-backed driver (STORAGE_DRIVER=db): serverless hosts like Vercel have an
   ephemeral filesystem, so contract bytes live in Postgres instead. Same port. */
export const dbStorage: StoragePort = {
  async put(key, data) {
    const k = safeKey(key);
    await (await import("./db/client")).pool.query(
      `INSERT INTO object_store (key, data, size, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, updated_at = now()`,
      [k, data, data.length]
    );
  },
  async get(key) {
    const res = await (await import("./db/client")).pool.query<{ data: Buffer }>(
      `SELECT data FROM object_store WHERE key = $1`, [safeKey(key)]
    );
    if (!res.rows[0]) throw new Error(`storage key not found: ${key}`);
    return res.rows[0].data;
  },
  async exists(key) {
    const res = await (await import("./db/client")).pool.query(
      `SELECT 1 FROM object_store WHERE key = $1`, [safeKey(key)]
    );
    return res.rowCount === 1;
  },
  async delete(key) {
    await (await import("./db/client")).pool.query(`DELETE FROM object_store WHERE key = $1`, [safeKey(key)]);
  },
  async list(prefix) {
    const res = await (await import("./db/client")).pool.query<{ key: string }>(
      `SELECT key FROM object_store WHERE key LIKE $1 ORDER BY key`, [safeKey(prefix) + "%"]
    );
    return res.rows.map((r) => r.key);
  }
};

/** STORAGE_DRIVER=db for serverless (Vercel), local filesystem otherwise. */
export const storage: StoragePort =
  (process.env.STORAGE_DRIVER || "local") === "db" ? dbStorage : localStorage;

/* ═══════════════════════════ LLMPort ═══════════════════════════════════
   Structured outputs + Zod validation on every call. Providers:
   openai | anthropic | fixture. Keys from .env.
   ═════════════════════════════════════════════════════════════════════ */
export interface LLMResult<T> {
  data: T;
  modelVersion: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LLMPort {
  readonly provider: string;
  readonly model: string;
  structured<T>(opts: {
    system: string;
    user: string;
    schema: ZodSchema<T>;
    temperature?: number;
    promptVersion: string;
    maxTokens?: number;
  }): Promise<LLMResult<T>>;
}

async function callOpenAI<T>(opts: {
  system: string; user: string; schema: ZodSchema<T>;
  temperature: number; model: string; maxTokens?: number;
}): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const jsonSchema = zodToJsonSchema(opts.schema);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond with JSON matching this schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: opts.user }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`openai_error ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    raw: body.choices[0].message.content,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0
  };
}

async function callAnthropic<T>(opts: {
  system: string; user: string; schema: ZodSchema<T>;
  temperature: number; model: string; maxTokens?: number;
}): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const jsonSchema = zodToJsonSchema(opts.schema);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature,
      system: `${opts.system}\n\nRespond with ONLY JSON matching this schema:\n${JSON.stringify(jsonSchema)}`,
      messages: [{ role: "user", content: opts.user }]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic_error ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json() as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  const raw = body.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { raw, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}

/** Minimal Zod→JSON-schema subset for structured-output hints. */
export function zodToJsonSchema(schema: ZodSchema<unknown>): Record<string, unknown> {
  const def = (schema as unknown as { _def?: { typeName: string; innerType?: ZodSchema<unknown>; shape?: () => Record<string, ZodSchema<unknown>>; values?: readonly string[]; description?: string; ofType?: ZodSchema<unknown> } })._def;
  if (!def) return {};
  switch (def.typeName) {
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodEnum": return { type: "string", enum: def.values };
    case "ZodLiteral": return { type: "string", enum: [(def as unknown as { value: string }).value] };
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const props: Record<string, unknown> = {};
      const req: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        props[k] = zodToJsonSchema(v);
        if (!v || !(v as unknown as { _def?: { typeName: string } })._def || !isOptional(v)) req.push(k);
      }
      return { type: "object", properties: props, required: req };
    }
    case "ZodArray": {
      // Zod stores the element schema in `_def.type` (fall back to innerType on older versions).
      const el = (def as unknown as { type?: ZodSchema<unknown> }).type ?? def.innerType;
      return { type: "array", items: el ? zodToJsonSchema(el) : {} };
    }
    case "ZodUnknown": return {};
    case "ZodUnion": return {};
    case "ZodOptional": return zodToJsonSchema(def.innerType as ZodSchema<unknown>);
    case "ZodNullable": {
      const inner = zodToJsonSchema(def.innerType as ZodSchema<unknown>);
      // `z.unknown().nullable()` has no JSON-schema equivalent — treat as any.
      return Object.keys(inner).length === 0 ? {} : { ...inner, nullable: true };
    }
    case "ZodDefault": return zodToJsonSchema(def.innerType as ZodSchema<unknown>);
    case "ZodEffects": return zodToJsonSchema(def.innerType as ZodSchema<unknown> ?? schema);
    case "ZodRecord": return { type: "object", additionalProperties: true };
    default: return {};
  }
}

function isOptional(v: ZodSchema<unknown>): boolean {
  const t = (v as unknown as { _def?: { typeName: string } })._def?.typeName;
  return t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable";
}

/* ── OpenAI adapter ───────────────────────────────────────────────────── */
function openAIAdapter(): LLMPort {
  const model = process.env.LLM_MODEL || "gpt-4o-2024-08-06";
  return {
    provider: "openai",
    model,
    async structured<T>(opts: { system: string; user: string; schema: ZodSchema<T>; temperature?: number; promptVersion: string; maxTokens?: number }) {
      const started = Date.now();
      const r = await callOpenAI({
        system: opts.system,
        user: opts.user,
        schema: opts.schema,
        temperature: opts.temperature ?? 0.1,
        model,
        maxTokens: opts.maxTokens
      });
      const parsed = opts.schema.parse(JSON.parse(r.raw));
      return {
        data: parsed,
        modelVersion: model,
        promptVersion: opts.promptVersion,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: Date.now() - started
      };
    }
  };
}

/* ── Anthropic adapter ────────────────────────────────────────────────── */
function anthropicAdapter(): LLMPort {
  const model = process.env.LLM_MODEL || "claude-sonnet-4-5-20250929";
  return {
    provider: "anthropic",
    model,
    async structured<T>(opts: { system: string; user: string; schema: ZodSchema<T>; temperature?: number; promptVersion: string; maxTokens?: number }) {
      const started = Date.now();
      const r = await callAnthropic({
        system: opts.system,
        user: opts.user,
        schema: opts.schema,
        temperature: opts.temperature ?? 0.1,
        model,
        maxTokens: opts.maxTokens
      });
      const parsed = opts.schema.parse(JSON.parse(r.raw));
      return {
        data: parsed,
        modelVersion: model,
        promptVersion: opts.promptVersion,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: Date.now() - started
      };
    }
  };
}

/* ── NVIDIA NIM adapter (OpenAI-compatible catalog.intel API) ──────────
   Base URL: https://integrate.api.nvidia.com/v1 (NVIDIA NIM hosted catalog).
   Per-task model routing via NIM_MODELS JSON, e.g.:
     NIM_MODELS={"default":"meta/llama-3.3-70b-instruct","extract":"meta/llama-3.3-70b-instruct","qa":"nvidia/llama-3.1-nemotron-70b-instruct","classify":"meta/llama-3.1-8b-instruct"}
   Falls back to NIM_MODEL (or LLM_MODEL) for any task not listed.
   Structured output: response_format json_object + schema in the system
   prompt, then Zod-validated (same contract as the OpenAI adapter).      */
function nimModelFor(promptVersion: string): string {
  const fallback = process.env.NIM_MODEL || process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b";
  const mapRaw = process.env.NIM_MODELS;
  if (mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as Record<string, string>;
      if (map[promptVersion]) return map[promptVersion];
    } catch { /* malformed NIM_MODELS — fall back */ }
  }
  return fallback;
}

async function callNIM<T>(opts: {
  system: string; user: string; schema: ZodSchema<T>;
  temperature: number; model: string; maxTokens?: number;
}): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  const key = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set (NVIDIA NIM provider)");
  const base = (process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const jsonSchema = zodToJsonSchema(opts.schema);
  // NIM honors OpenAI-style json_schema (server-side constrained decoding), so the
  // model output is guaranteed to be schema-shaped. gpt-oss models also accept
  // reasoning_effort — keep it low for classifier latency.
  const isGptOss = opts.model.startsWith("openai/gpt-oss");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, accept: "application/json" },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      // Large extraction schemas (29 fields with citations) produce >4k tokens
      // of JSON; default well above that and fail loudly on truncation.
      max_tokens: opts.maxTokens ?? 16384,
      ...(isGptOss ? { reasoning_effort: "low" } : {}),
      response_format: { type: "json_schema", json_schema: { name: "out", schema: jsonSchema } },
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond with ONLY a JSON object matching this schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: opts.user }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`nim_error ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json() as {
    choices: { message: { content: string }; finish_reason?: string }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  if (body.choices[0]?.finish_reason === "length") {
    throw new Error("nim_error: output truncated (finish_reason=length) — increase max_tokens");
  }
  return {
    raw: body.choices[0]?.message?.content ?? "",
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0
  };
}

function nimAdapter(): LLMPort {
  return {
    provider: "nim",
    model: process.env.NIM_MODEL || process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b",
    async structured<T>(opts: { system: string; user: string; schema: ZodSchema<T>; temperature?: number; promptVersion: string; maxTokens?: number }) {
      const model = nimModelFor(opts.promptVersion);
      const started = Date.now();
      const call = (userExtra?: string) => callNIM({
        system: opts.system,
        user: userExtra ? `${opts.user}\n\n${userExtra}` : opts.user,
        schema: opts.schema,
        temperature: opts.temperature ?? 0.1,
        model,
        maxTokens: opts.maxTokens
      });
      let r = await call();
      let parsed: T;
      try {
        parsed = opts.schema.parse(JSON.parse(r.raw));
      } catch (err) {
        // Rule 5: exactly ONE bounded repair retry that feeds the validation
        // error back to the model; a second failure propagates so the caller
        // degrades to not_found instead of retrying forever.
        const msg = err instanceof Error ? err.message.slice(0, 400) : "invalid JSON";
        r = await call(`Your previous response was invalid (${msg}). Return ONLY corrected JSON matching the schema exactly. Do not repeat the error.`);
        parsed = opts.schema.parse(JSON.parse(r.raw));
      }
      return {
        data: parsed,
        modelVersion: model,
        promptVersion: opts.promptVersion,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: Date.now() - started
      };
    }
  };
}

/* ── Fixture adapter: deterministic offline responses (demo fallback) ─── */
export interface FixtureSpec {
  promptVersion: string;
  data: unknown;
}

function fixtureAdapter(): LLMPort {
  const store = (globalThis as unknown as { __clFixtures?: Map<string, unknown[]> }).__clFixtures ?? new Map();
  (globalThis as unknown as { __clFixtures?: Map<string, unknown[]> }).__clFixtures = store;
  return {
    provider: "fixture",
    model: "fixture-v1",
    async structured<T>(opts: { promptVersion: string; schema: ZodSchema<T>; user: string }) {
      const queue = store.get(opts.promptVersion);
      let payload: unknown;
      if (queue && queue.length > 0) {
        payload = queue.shift();
      } else {
        // Derive a schema-empty default so dev flows never hard-crash offline.
        payload = defaultForSchema(opts.schema);
      }
      return {
        data: opts.schema.parse(payload),
        modelVersion: "fixture-v1",
        promptVersion: opts.promptVersion,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 1
      };
    }
  };
}

function defaultForSchema<T>(schema: ZodSchema<T>): unknown {
  const json = zodToJsonSchema(schema);
  function build(node: Record<string, unknown>): unknown {
    const t = node.type as string | undefined;
    if (node.enum) return (node.enum as unknown[])[0];
    if (t === "string") return "";
    if (t === "number") return 0;
    if (t === "boolean") return false;
    if (t === "array") return [];
    if (t === "object") {
      const out: Record<string, unknown> = {};
      const props = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [k, v] of Object.entries(props)) out[k] = build(v);
      return out;
    }
    return null;
  }
  const json2 = json as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  if (json2.properties) {
    return {
      fields: [],
      claims: [],
      ...(build(json) as object)
    };
  }
  return build(json);
}

let cachedLLM: LLMPort | null = null;
export function llm(): LLMPort {
  if (cachedLLM) return cachedLLM;
  const provider = (process.env.LLM_PROVIDER || "fixture").toLowerCase();
  cachedLLM =
    provider === "openai" ? openAIAdapter() :
    provider === "anthropic" ? anthropicAdapter() :
    provider === "nim" || provider === "nvidia" ? nimAdapter() :
    fixtureAdapter();
  return cachedLLM;
}

/** Register a recorded fixture for a prompt version (used by seed + demos). */
export function pushFixtures(promptVersion: string, items: unknown[]) {
  const store = (globalThis as unknown as { __clFixtures?: Map<string, unknown[]> }).__clFixtures ?? new Map();
  (globalThis as unknown as { __clFixtures?: Map<string, unknown[]> }).__clFixtures = store;
  store.set(promptVersion, items);
}

/* ═══════════════════════ EmbeddingPort ═════════════════════════════════ */
export interface EmbeddingPort {
  readonly provider: string;
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

function openAIEmbeddings(): EmbeddingPort {
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const dim = Number(process.env.EMBEDDING_DIM || 1536);
  return {
    provider: "openai",
    model,
    dim,
    async embed(texts) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts })
      });
      if (!res.ok) throw new Error(`openai_embeddings_error ${res.status}`);
      const body = await res.json() as { data: { embedding: number[] }[] };
      return body.data.map((d) => d.embedding);
    }
  };
}

/** NVIDIA NIM embeddings (e.g. nvidia/nv-embedqa-e5-v5, 1024-dim native, input_type=query|passage).
 *  Vectors are zero-padded/truncated to EMBEDDING_DIM (default 1536 = column width) so any NIM
 *  embedding model works against the fixed `vector(1536)` schema: zero components contribute
 *  nothing to the cosine dot product or norm, so similarity rankings are mathematically unchanged. */
function nimEmbeddings(): EmbeddingPort {
  const model = process.env.EMBEDDING_MODEL || "nvidia/nv-embedqa-e5-v5";
  const storageDim = Number(process.env.EMBEDDING_DIM || 1536);
  return {
    provider: "nim",
    model,
    dim: storageDim,
    async embed(texts) {
      const key = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY;
      if (!key) throw new Error("NVIDIA_API_KEY is not set (NVIDIA NIM embeddings)");
      const base = (process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
      const out: number[][] = [];
      // NIM embeddings accept limited batch sizes — send one at a time with the
      // correct input_type per call shape.
      for (const t of texts) {
        const res = await fetch(`${base}/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}`, accept: "application/json" },
          body: JSON.stringify({
            model,
            input: [t],
            input_type: t.length > 400 ? "passage" : "query",
            encoding_format: "float",
            truncate: "END"
          })
        });
        if (!res.ok) throw new Error(`nim_embeddings_error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = await res.json() as { data: { embedding: number[] }[] };
        const v = body.data[0].embedding;
        if (v.length > storageDim) v.length = storageDim;
        while (v.length < storageDim) v.push(0);
        out.push(v);
      }
      return out;
    }
  };
}

/** Deterministic hashing embeddings for offline dev — not semantic, keeps the pipeline runnable. */
function localHashEmbeddings(dim: number): EmbeddingPort {
  return {
    provider: "local-hash",
    model: "hash-1536",
    dim,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(dim).fill(0);
        const tokens = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        for (const tok of tokens) {
          let h = 2166136261;
          for (let i = 0; i < tok.length; i++) {
            h ^= tok.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          v[Math.abs(h) % dim] += 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      });
    }
  };
}

let cachedEmb: EmbeddingPort | null = null;
export function embeddings(): EmbeddingPort {
  if (cachedEmb) return cachedEmb;
  const provider = (process.env.EMBEDDING_PROVIDER || "local-hash").toLowerCase();
  const dim = Number(process.env.EMBEDDING_DIM || 1536);
  cachedEmb =
    provider === "openai" ? openAIEmbeddings() :
    provider === "nim" || provider === "nvidia" ? nimEmbeddings() :
    localHashEmbeddings(dim);
  return cachedEmb;
}

/* ═══════════════════════ OcrPort ═══════════════════════════════════════ */
export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  words: { text: string; x: number; y: number; w: number; h: number }[];
}

export interface OcrPort {
  readonly provider: string;
  recognizePage(png: Buffer, pageNumber: number): Promise<OcrPageResult>;
}

let tesseractWorker: { terminate(): Promise<unknown> } | null = null;

export const tesseractOcr: OcrPort = {
  provider: "tesseract.js",
  async recognizePage(png: Buffer, pageNumber: number) {
    const { createWorker } = await import("tesseract.js");
    if (!tesseractWorker) tesseractWorker = (await createWorker("eng")) as unknown as { terminate(): Promise<unknown> };
    const worker = tesseractWorker as unknown as {
      recognize: (img: Buffer) => Promise<{
        data: { text: string; confidence: number; words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] };
      }>;
    };
    const { data } = await worker.recognize(png);
    return {
      pageNumber,
      text: data.text,
      confidence: data.confidence / 100,
      words: data.words.map((w) => ({
        text: w.text,
        x: w.bbox.x0, y: w.bbox.y0,
        w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0
      }))
    };
  }
};

export const ocr: OcrPort = tesseractOcr;
