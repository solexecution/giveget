FROM oven/bun:1.2
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN mkdir -p data/photos

ENV NODE_ENV=production
ENV PORT=3000
ENV GIVEGET_DB=/app/data/giveget.db
ENV GIVEGET_PHOTOS_DIR=/app/data/photos

EXPOSE 3000
CMD ["sh", "-c", "bun run scripts/seed-if-empty.ts && bun run src/server.ts"]
