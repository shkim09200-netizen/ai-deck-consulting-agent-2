import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODELS = {
  /** heavy generation. Sonnet for speed (2–3× faster than Opus); switch back to
   *  "claude-opus-4-8" here if you want maximum quality over speed. */
  generate: "claude-sonnet-5",
  /** lightweight extraction / review */
  light: "claude-sonnet-5",
} as const;

let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
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
  const res = await client.messages.create({
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
