import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODELS = {
  /** heavy generation. Opus: reliable structured tool output (Sonnet tends to
   *  stringify complex fields). Switch to "claude-sonnet-5" for ~2–3× speed. */
  generate: "claude-opus-4-8",
  /** lightweight extraction / review */
  light: "claude-sonnet-5",
} as const;

let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    // Raise the SDK's built-in retry budget; on top of this callTool adds its own
    // backoff for 529 "overloaded" bursts (common when we fan out batch calls).
    _client = new Anthropic({ apiKey, maxRetries: 4 });
  }
  return _client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transient API failures worth retrying: overloaded (529), rate limit (429),
 *  and 5xx / connection hiccups. 4xx (bad request, auth) are NOT retried. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 529 || (typeof status === "number" && status >= 500)) return true;
  const name = (err as { name?: string })?.name ?? "";
  const msg = (err as { message?: string })?.message ?? "";
  return /overloaded|APIConnection|ECONNRESET|ETIMEDOUT|fetch failed/i.test(`${name} ${msg}`);
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ToolCallOptions<S extends z.ZodTypeAny> {
  model?: string;
  system: string;
  /** the user turn(s) */
  messages: Anthropic.MessageParam[];
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool input */
  inputSchema: Anthropic.Tool.InputSchema;
  /** zod validator applied to the returned tool input */
  validator: S;
  maxTokens?: number;
}

/**
 * Force a single structured tool call and return the validated input.
 * All generation/extraction/review goes through here (§5.5).
 */
export async function callTool<S extends z.ZodTypeAny>(opts: ToolCallOptions<S>): Promise<z.infer<S>> {
  const client = getClient();

  // Retry the request on transient overload (529) / rate limit / 5xx with
  // exponential backoff + jitter, so a temporary Anthropic capacity blip doesn't
  // fail the whole generation. Deterministic failures fall through immediately.
  const MAX_ATTEMPTS = 6;
  let res: Anthropic.Message | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await client.messages.create({
        model: opts.model ?? MODELS.generate,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages: opts.messages,
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.inputSchema,
          },
        ],
        tool_choice: { type: "tool", name: opts.toolName },
      });
      break;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransient(err)) {
        if (isTransient(err)) {
          throw new Error(
            `모델 서버가 일시적으로 과부하 상태입니다(${(err as { status?: number })?.status ?? "overloaded"}). 잠시 후 다시 시도해 주세요.`,
          );
        }
        throw err;
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 16000) + Math.floor(Math.random() * 500);
      await sleep(backoff);
    }
  }

  if (!res) throw new Error(`Tool ${opts.toolName} 호출에 실패했습니다.`);
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`Model did not return a tool_use block for ${opts.toolName}`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error(
      `Tool ${opts.toolName} output was truncated at max_tokens (${opts.maxTokens ?? 8000}). Raise maxTokens or split the request.`,
    );
  }
  // Sonnet occasionally returns the whole tool input as a JSON string — parse it
  // before validating so field-level tolerance in the validators can kick in.
  let toolInput: unknown = block.input;
  if (typeof toolInput === "string") {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      /* leave as-is; the validator will surface a clear error */
    }
  }
  const parsed = opts.validator.safeParse(toolInput);
  if (!parsed.success) {
    throw new Error(
      `Tool ${opts.toolName} returned schema-invalid input:\n${parsed.error.toString()}\nraw: ${JSON.stringify(block.input).slice(0, 800)}`,
    );
  }
  return parsed.data;
}
