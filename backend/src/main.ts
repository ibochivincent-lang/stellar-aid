import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// Prisma's `BigInt` columns (voucher/program amounts) come back as native
// JS `bigint`, which `JSON.stringify` throws on ("Do not know how to
// serialize a BigInt") — so any endpoint returning a Voucher/AidProgram
// record would crash. Stringify them instead; every amount here is small
// enough that precision loss from `Number` isn't the concern, JSON's lack
// of a bigint type is.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
  this: bigint,
): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? false,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('bootstrap').log(`StellarAID backend listening on :${port}`);
}

void bootstrap();
