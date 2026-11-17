FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
RUN npm install
WORKDIR /app
COPY prisma ./prisma
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate --schema=/app/prisma/schema.prisma && npm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start"]
