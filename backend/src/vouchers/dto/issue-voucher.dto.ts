import { IsInt, IsNumberString, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

/**
 * A `class-validator` class, not a bare interface. Nest's global
 * `ValidationPipe` (see main.ts) only actually validates/whitelists against
 * classes carrying decorators like these — against a plain TS interface
 * (what this used to be) it's a no-op, so a malformed request would sail
 * past validation and fail deeper in the stack with a far less useful error.
 */
export class IssueVoucherDto {
  @IsString()
  @Length(1, 64)
  recipientWallet!: string;

  @IsInt()
  @Min(0)
  voucherId!: number;

  /** Raw token units, as a decimal string (fits in i128 on the contract side). */
  @IsNumberString()
  amount!: string;

  // Soroban `Symbol`s are capped at 32 characters — validate that here so a
  // bad category/region fails with a clear 400 instead of a cryptic error
  // out of `nativeToScVal` or the contract call itself.
  @IsString()
  @Length(1, 32)
  category!: string;

  @IsString()
  @Length(1, 32)
  region!: string;

  /** Ledger timestamp (seconds since epoch) — must be in the future. */
  @IsInt()
  @IsPositive()
  expiresAt!: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  programId?: string;
}
