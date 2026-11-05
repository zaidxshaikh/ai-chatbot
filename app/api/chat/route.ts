import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Role = "user" | "assistant";
type ChatMessage = { role: Role; content: string };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;

// Simple in-memory rate limiter (per server instance).
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_MESSAGES &&
    value.every(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0 &&
        m.content.length <= MAX_CHARS_PER_MESSAGE
    )
  );
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonError("Server is missing GROQ_API_KEY. Add it to .env.local", 500);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return jsonError("Too many requests. Ek minute baad try karo.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!isValidMessages(messages)) {
    return jsonError(
      `Send 1-${MAX_MESSAGES} messages, each under ${MAX_CHARS_PER_MESSAGE} characters`,
      400
    );
  }

  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        stream: true,
        temperature: 0.7,
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: process.env.SYSTEM_PROMPT ?? "You are a helpful assistant.",
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error("[chat] upstream request failed", err);
    return jsonError("AI service tak nahi pahunch paye. Dobara try karo.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[chat] upstream error", upstream.status, detail.slice(0, 500));
    const status = upstream.status === 429 ? 429 : 502;
    return jsonError(
      status === 429 ? "Free limit hit ho gaya. Thodi der baad try karo." : "AI service error",
      status
    );
  }

  // Convert Groq's server-sent events into a plain text stream for the browser.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let chars = 0;

  const stream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const text: string | undefined = json.choices?.[0]?.delta?.content;
            if (text) {
              chars += text.length;
              controller.enqueue(encoder.encode(text));
            }
          } catch {
            // Ignore partial or keep-alive lines.
          }
        }
      },
      flush() {
        console.log(
          JSON.stringify({ event: "chat_complete", ms: Date.now() - startedAt, chars })
        );
      },
    })
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
