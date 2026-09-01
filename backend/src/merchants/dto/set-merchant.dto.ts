import { IsBoolean, IsString, Length } from 'class-validator';

export class SetMerchantDto {
  @IsString()
  @Length(1, 64)
  wallet!: string;

  @IsBoolean()
  active!: boolean;

  @IsString()
  @Length(1, 64)
  name!: string;

  @IsString()
  @Length(1, 32)
  region!: string;
}
