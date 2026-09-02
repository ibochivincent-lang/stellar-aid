import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from './ai-provider';
import { RedactionService } from './redaction.service';
import { RetrievalService } from './retrieval.service';
import { VectorStoreService } from './vector-store.service';

const SYSTEM_PROMPT = `You are the StellarAID citizen assistant. You answer plain-language
questions about a citizen's aid voucher(s): what it can be spent on (category/region and
which merchants accept it), when it expires, and its current status.

Rules you must follow:
- You are given the citizen's voucher context as JSON below. Never invent a voucher,
  merchant, or program that isn't in that context.
- The context never contains amounts, balances, or budgets, and it never will — if asked
  "how much is my voucher worth" or anything about a balance, say that balance information
  isn't something you can share here, and suggest checking their wallet app.
- Keep answers short, plain-language, and specific to what's in the context.
- If the context has no vouchers for this citizen, say so plainly rather than guessing.`;

/**
 * Orchestrates one chat turn: redact the incoming question, pull the
 * citizen's own (financial-field-free) context, optionally add semantic
 * search results over indexed FAQ/policy text, build the prompt, and
 * stream the model's answer back token-by-token.
 *
 * Streaming note: the README's suggested stack mentions the Vercel AI SDK
 * for streaming, which is built around Next.js/edge request handlers. This
 * is a NestJS/Express app, and Nest already has a native streaming
 * primitive that fits it — Server-Sent Events (`@Sse()`, already used by
 * `events/events.controller.ts`) — so the controller streams this
 * service's `AsyncIterable<string>` over SSE directly rather than pulling
 * in a second streaming library whose runtime assumptions don't match
 * this server. Swapping in the Vercel AI SDK later is still possible (it
 * can consume any async iterable of tokens) if the frontend specifically
 * wants its client-side hooks.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly vectorStore: VectorStoreService,
    private readonly redaction: RedactionService,
  ) {}

  async *answer(wallet: string, question: string): AsyncGenerator<string> {
    const safeQuestion = this.redaction.redactText(question);

    const context = await this.retrieval.forCitizen(wallet);
    const contextBlock = this.retrieval.toPromptContext(context);

    const semanticHits = await this.vectorStore.search(safeQuestion, 4);
    const semanticBlock = semanticHits.length
      ? `\n\nRelevant program policy excerpts:\n${semanticHits.map((h) => `- ${h.content}`).join('\n')}`
      : '';

    const model = createChatModel();
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Citizen voucher context (JSON):\n${contextBlock}${semanticBlock}\n\nQuestion: ${safeQuestion}`,
      ),
    ];

    try {
      const stream = await model.stream(messages);
      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : this.flattenContent(chunk.content);
        if (text) yield text;
      }
    } catch (e) {
      this.logger.error(`assistant stream failed: ${e}`);
      throw e;
    }
  }

  /** LangChain message content can be a string or an array of content parts (text/image/etc). */
  private flattenContent(content: unknown): string {
    if (!Array.isArray(content)) return '';
    return content
      .map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : ''))
      .join('');
  }
}
