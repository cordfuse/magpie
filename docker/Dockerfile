# Quill — Next.js standalone build, multi-stage.
#
# Build context expectation: this Dockerfile is built from the repo root
# (one level above the docker/ folder), NOT from inside docker/. See
# docker-compose.yml — `build: { context: .., dockerfile: docker/Dockerfile }`.

FROM node:22-alpine AS builder
WORKDIR /app
COPY nodejs/package*.json ./
RUN npm ci
COPY nodejs/. .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
