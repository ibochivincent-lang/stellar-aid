import { Logger } from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

// Deliberately NOT annotated with `@langchain/core`'s `BaseChatModel` /
// `Embeddings` base types below — with a single provider package pulling
// in its own nested type declarations, TS can end up seeing two
// structurally-identical-but-nominally-different copies of these generic
// base classes ("two different types with this name exist, but they are
// unrelated") depending on which package's re-export path resolves them.
// Letting TS infer the concrete return type (`ChatOpenAI | ChatAnthropic`,
// `OpenAIEmbeddings`) sidesteps that assignability check entirely —
// callers only ever use `.stream()` / `.invoke()` / `.embedDocuments()`,
// which exist on the concrete classes regardless.

const logger = new Logger('AiProvider');

/**
 * Picks a LangChain chat model from env config, so swapping providers is a
 * config change, not a code change — the README says "any hosted model,"
 * so this is deliberately not hardcoded to one vendor's SDK beyond what
 * `AI_PROVIDER` selects.
 *
 * `AI_PROVIDER=openai` (default) uses `OPENAI_API_KEY` + `AI_MODEL`
 * (default `gpt-4o-mini`). `AI_PROVIDER=anthropic` uses
 * `ANTHROPIC_API_KEY` + `AI_MODEL` (default `claude-3-5-haiku-latest`).
 * Throws rather than silently no-op'ing if the selected provider's API key
 * is missing — same fail-closed pattern as `AuthService`/the old
 * `AdminGuard`: a misconfigured assistant should error loudly, not
 * pretend to answer with an unauthenticated client that will fail on the
 * first real call anyway.
 */
export function createChatModel() {
  const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();

  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
    }
    return new ChatAnthropic({
      model: process.env.AI_MODEL ?? 'claude-3-5-haiku-latest',
      temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
    });
  }

  if (provider !== 'openai') {
    logger.warn(`Unknown AI_PROVIDER "${provider}" — falling back to openai`);
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER=openai (the default) requires OPENAI_API_KEY');
  }
  return new ChatOpenAI({
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
  });
}

/**
 * Embeddings are kept on a separate provider switch from the chat model
 * (`AI_EMBEDDINGS_PROVIDER`, default `openai`) since not every chat
 * provider (Anthropic, notably) offers an embeddings endpoint at all —
 * a deployment can use Claude for chat and still need OpenAI (or another
 * embeddings-capable provider) for `VectorStoreService`.
 */
export function createEmbeddings() {
  const provider = (process.env.AI_EMBEDDINGS_PROVIDER ?? 'openai').toLowerCase();
  if (provider !== 'openai') {
    throw new Error(
      `AI_EMBEDDINGS_PROVIDER=${provider} is not supported yet — only "openai" is wired up`,
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('AI_EMBEDDINGS_PROVIDER=openai requires OPENAI_API_KEY');
  }
  return new OpenAIEmbeddings({ model: process.env.AI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small' });
}
