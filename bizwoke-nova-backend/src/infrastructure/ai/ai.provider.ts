import { env } from '../../config/env';
import { logger } from '../../common/logging/logger';

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: AiContent[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiCompletionRequest {
  system: string;
  messages: AiMessage[];
  tools: AiToolDefinition[];
  model?: string;
  maxTokens?: number;
}

export interface AiCompletion {
  content: AiContent[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface AiProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const { AI_TIMEOUT_MS, AI_MAX_RETRIES } = env();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      const text = (await res.text()).slice(0, 300);
      lastErr = new AiProviderError(`AI provider HTTP ${res.status}: ${text}`, retryable);
      if (!retryable) throw lastErr;
    } catch (err) {
      lastErr =
        err instanceof AiProviderError
          ? err
          : new AiProviderError((err as Error).message ?? 'AI request failed', true);
      if (!(lastErr as AiProviderError).retryable) throw lastErr;
    }
    if (attempt < AI_MAX_RETRIES) await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 4000)));
  }
  logger.warn({ err: lastErr }, 'AI provider request exhausted retries');
  throw lastErr;
}

/** Anthropic Messages API adapter. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string,
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {}

  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const model = req.model ?? this.defaultModel;
    const body = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content.map((c) =>
          c.type === 'text'
            ? { type: 'text', text: c.text }
            : c.type === 'tool_use'
              ? { type: 'tool_use', id: c.id, name: c.name, input: c.input }
              : {
                  type: 'tool_result',
                  tool_use_id: c.toolUseId,
                  content: c.content,
                  is_error: c.isError ?? false,
                },
        ),
      })),
    };
    const json = (await postJson(
      `${this.baseUrl}/v1/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body,
    )) as {
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    const content: AiContent[] = [];
    for (const c of json.content ?? []) {
      if (c.type === 'text' && c.text) content.push({ type: 'text', text: c.text });
      if (c.type === 'tool_use' && c.id && c.name)
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} });
    }
    const stop =
      json.stop_reason === 'end_turn' || json.stop_reason === 'tool_use' || json.stop_reason === 'max_tokens'
        ? json.stop_reason
        : 'other';
    return {
      content,
      stopReason: stop,
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
      model,
    };
  }
}

/** OpenAI-compatible Chat Completions adapter (works with OpenAI and compatible gateways). */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const model = req.model ?? this.defaultModel;
    const messages: Record<string, unknown>[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      const text = m.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join('\n');
      const toolUses = m.content.filter((c) => c.type === 'tool_use') as Extract<
        AiContent,
        { type: 'tool_use' }
      >[];
      const toolResults = m.content.filter((c) => c.type === 'tool_result') as Extract<
        AiContent,
        { type: 'tool_result' }
      >[];
      if (m.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(toolUses.length
            ? {
                tool_calls: toolUses.map((t) => ({
                  id: t.id,
                  type: 'function',
                  function: { name: t.name, arguments: JSON.stringify(t.input) },
                })),
              }
            : {}),
        });
      } else {
        for (const r of toolResults)
          messages.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
        if (text) messages.push({ role: 'user', content: text });
      }
    }
    const json = (await postJson(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model,
        max_tokens: req.maxTokens ?? 1024,
        messages,
        tools: req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      },
    )) as {
      choices: {
        message: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        finish_reason: string;
      }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = json.choices?.[0];
    const content: AiContent[] = [];
    if (choice?.message.content) content.push({ type: 'text', text: choice.message.content });
    for (const tc of choice?.message.tool_calls ?? []) {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        input = { __invalid_json: true };
      }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    const fr = choice?.finish_reason;
    const stopReason =
      fr === 'tool_calls'
        ? 'tool_use'
        : fr === 'stop'
          ? 'end_turn'
          : fr === 'length'
            ? 'max_tokens'
            : 'other';
    return {
      content,
      stopReason,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      model,
    };
  }
}

let override: AiProvider | null | undefined;

/** Null when AI is not configured: callers must surface INTEGRATION_UNAVAILABLE, never a fake reply. */
export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  const e = env();
  if (!e.AI_PROVIDER || !e.AI_API_KEY) return null;
  if (e.AI_PROVIDER === 'anthropic')
    return new AnthropicProvider(e.AI_API_KEY, e.AI_MODEL ?? 'claude-sonnet-5-5', e.AI_BASE_URL);
  if (!e.AI_MODEL) return null;
  return new OpenAiCompatibleProvider(e.AI_API_KEY, e.AI_MODEL, e.AI_BASE_URL);
}

export function setAiProviderForTests(p: AiProvider | null | undefined) {
  override = p;
}
