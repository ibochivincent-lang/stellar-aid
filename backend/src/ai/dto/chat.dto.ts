import { IsString, Length } from 'class-validator';

export class ChatDto {
  /** The citizen's public wallet address — scopes retrieval to their own vouchers only. */
  @IsString()
  @Length(1, 64)
  wallet!: string;

  @IsString()
  @Length(1, 2000)
  question!: string;
}
