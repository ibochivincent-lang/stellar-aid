import { Injectable } from '@nestjs/common';

/**
 * PII/financial redaction guardrail for the citizen assistant (README
 * item: "Guardrail: PII redaction before anything hits the prompt; never
 * include voucher balances").
 *
 * Two separate jobs, both here on purpose:
 *
 *  1. `redactText` — scrubs PII-shaped substrings (Stellar secret keys,
 *     emails, phone numbers, long digit runs that look like a national ID)
 *     out of free text before it's logged or sent to a model provider.
 *     This runs on the citizen's raw question too — a citizen pasting
 *     their own secret key into the chat box must not have it forwarded
 *     to a third-party LLM API.
 *  2. `stripFinancialFields` — defense in depth against a future
 *     `RetrievalService` change accidentally including a balance/amount
 *     field in the context object handed to the model. `RetrievalService`
 *     is already supposed to never select those fields in the first
 *     place; this is the second guardrail, not the only one — the
 *     confidentiality promise here (voucher amounts are private) must not
 *     depend on one file never being edited carelessly.
 */
@Injectable()
export class RedactionService {
  private static readonly PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    // Stellar ed25519 secret seed: 'S' + 55 base32 chars.
    { name: 'stellar-secret-key', pattern: /\bS[A-Z2-7]{55}\b/g },
    { name: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
    // Loose international phone shape — over-matching is fine here, a
    // false positive just redacts a non-phone number of digits.
    { name: 'phone', pattern: /\b(?:\+?\d[\s-]?){9,15}\b/g },
    // Long digit runs (9+) that aren't already caught above — the shape
    // national IDs, passport numbers, and card numbers tend to share.
    { name: 'long-digit-id', pattern: /\b\d{9,}\b/g },
  ];

  /** Keys that must never appear in a prompt context object, whatever selected them. */
  private static readonly FINANCIAL_KEYS = new Set([
    'amount',
    'spent',
    'balance',
    'totalBudget',
    'spentBudget',
    'remaining',
  ]);

  redactText(text: string): string {
    let result = text;
    for (const { name, pattern } of RedactionService.PATTERNS) {
      result = result.replace(pattern, `[redacted:${name}]`);
    }
    return result;
  }

  /** Deep-strips any financial key from a plain JSON-shaped object/array before it reaches a prompt. */
  stripFinancialFields<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((v) => this.stripFinancialFields(v)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (RedactionService.FINANCIAL_KEYS.has(key)) continue;
        out[key] = this.stripFinancialFields(v);
      }
      return out as T;
    }
    return value;
  }
}
