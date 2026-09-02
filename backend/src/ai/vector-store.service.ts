import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { createEmbeddings } from './ai-provider';

export interface RetrievedDocument {
  content: string;
  programId: string | null;
  distance: number;
}

/**
 * Semantic search over `AiDocument` (FAQ/policy text) via pgvector,
 * talking to Postgres directly through `pg` rather than through Prisma —
 * Prisma's generated Client has no methods for a column declared
 * `Unsupported("vector(1536)")`, only `$queryRawUnsafe`/`$executeRawUnsafe`
 * reach it. A dedicated `pg.Pool` (reusing `DATABASE_URL`) is simpler and
 * more stable here than routing through a LangChain vectorstore
 * integration package — `@langchain/community`'s `PGVectorStore` is
 * deprecated upstream as of this writing, and there's no dedicated
 * `@langchain/postgres` replacement yet, so hand-rolled SQL against
 * pgvector's `<=>` cosine-distance operator is the safer bet.
 *
 * Entirely optional: `AssistantService` only calls this when
 * `AI_ENABLE_VECTOR_SEARCH=true`, and every method here fails soft
 * (logs + returns empty) rather than breaking a chat request — a citizen
 * asking a factual question ("when does my voucher expire") should still
 * get an answer from `RetrievalService` alone even if the vector store
 * isn't configured, unreachable, or the `vector` extension was never
 * enabled on this database.
 *
 * Setup this needs, once, outside the app:
 *   CREATE EXTENSION IF NOT EXISTS vector;   -- `prisma migrate` attempts
 *                                              this too, see schema.prisma
 *   -- then `prisma migrate dev` creates the `AiDocument` table itself.
 * Ingesting FAQ/policy content into it is out of scope here — this class
 * only reads/writes the table; a program admin populating it (via
 * `ingest`) is a separate operational step.
 */
@Injectable()
export class VectorStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorStoreService.name);
  private pool?: Pool;

  get enabled(): boolean {
    return process.env.AI_ENABLE_VECTOR_SEARCH === 'true';
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async ingest(docs: Array<{ content: string; programId?: string }>): Promise<void> {
    if (!this.enabled || docs.length === 0) return;
    try {
      const embeddings = createEmbeddings();
      const vectors = await embeddings.embedDocuments(docs.map((d) => d.content));
      const pool = this.getPool();
      for (let i = 0; i < docs.length; i++) {
        await pool.query(
          `INSERT INTO "AiDocument" (id, "programId", content, embedding, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, now())`,
          [docs[i].programId ?? null, docs[i].content, JSON.stringify(vectors[i])],
        );
      }
    } catch (e) {
      this.logger.warn(`vector store ingest failed: ${e}`);
    }
  }

  async search(query: string, k = 4): Promise<RetrievedDocument[]> {
    if (!this.enabled) return [];
    try {
      const embeddings = createEmbeddings();
      const [queryVector] = await embeddings.embedDocuments([query]);
      const pool = this.getPool();
      const res = await pool.query<{ content: string; programId: string | null; distance: number }>(
        `SELECT content, "programId", embedding <=> $1 AS distance
         FROM "AiDocument"
         ORDER BY embedding <=> $1
         LIMIT $2`,
        [JSON.stringify(queryVector), k],
      );
      return res.rows;
    } catch (e) {
      this.logger.warn(`vector store search failed, continuing without semantic context: ${e}`);
      return [];
    }
  }
}
