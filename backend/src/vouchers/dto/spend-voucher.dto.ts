import { IsNumberString, IsString, Length } from 'class-validator';

export class SpendVoucherDto {
  @IsString()
  @Length(1, 64)
  spenderPublicKey!: string;

  @IsString()
  @Length(1, 64)
  merchantWallet!: string;

  @IsNumberString()
  amount!: string;
}
