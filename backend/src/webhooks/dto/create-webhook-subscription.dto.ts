import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class CreateWebhookSubscriptionDto {
  // `require_tld: false` so http(s)://localhost / internal hostnames still
  // parse as valid URLs — they get rejected for SSRF risk by
  // `assertSafeWebhookUrl`, not by this shape check. This DTO only rules out
  // garbage that isn't a URL at all (e.g. empty string, `not-a-url`).
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @Length(1, 2048)
  url!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  eventTypes?: string[];
}
