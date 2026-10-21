FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /web
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web ./
ARG NEXT_PUBLIC_GAME_WS
ARG NEXT_PUBLIC_DEMO_WS
ENV NEXT_PUBLIC_GAME_WS=$NEXT_PUBLIC_GAME_WS NEXT_PUBLIC_DEMO_WS=$NEXT_PUBLIC_DEMO_WS NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web ./
EXPOSE 3100
CMD ["pnpm", "start", "-p", "3100"]
