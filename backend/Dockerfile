# StellarAID backend — NestJS API + event delivery + webhooks.
#
# Multi-stage build: `deps` installs full (dev+prod) dependencies once and is
# reused by both `build` (needs devDependencies — nest-cli, typescript,
# prisma) and, via a second `npm ci --omit=dev`, the final runtime image
# (prod dependencies only, keeping the shipped image smaller than copying
# node_modules from `deps` wholesale).
#
# `npx prisma generate` needs network access to binaries.prisma.sh to fetch
# the query-engine binary for the target platform — make sure that host is
# reachable from wherever this image is built (some CI/sandboxed build
# environments block it; see the Prisma section of DEPLOYMENT.md if this
# stage fails there).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Runs as the built-in unprivileged `node` user rather than root.
USER node

EXPOSE 3000

# Applies any pending migrations, then starts the API. `prisma migrate
# deploy` (unlike `migrate dev`) never creates/resets the shadow database or
# prompts — safe to run unattended on every container start, and a no-op
# when there's nothing pending.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
