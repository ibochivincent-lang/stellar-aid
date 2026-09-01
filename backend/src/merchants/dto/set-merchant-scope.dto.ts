import { ArrayMaxSize, IsArray, IsString, Length } from 'class-validator';

/**
 * Categories/regions are stored on-chain as Soroban `Symbol`s, which cap at
 * 32 characters and a restricted charset (`[A-Za-z0-9_]`) — that's why each
 * entry is length-capped here too, so a bad value 400s at the API boundary
 * instead of failing deep inside `nativeToScVal`/the contract call.
 *
 * An empty array means "unrestricted" on-chain (see `MerchantProfile` in
 * the contract) — send `[]` explicitly to clear a prior restriction rather
 * than omitting the field, since this DTO has no optional/undefined case.
 */
export class SetMerchantScopeDto {
  @IsString()
  @Length(1, 64)
  wallet!: string;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  categories!: string[];

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  regions!: string[];
}
