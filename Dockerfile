FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV GP_HOOT_DB_PATH=/app/data/gp-hoot-db.json
ENV GP_HOOT_UPLOAD_ROOT=/app/uploads

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/uploads/gp-hoot

EXPOSE 3000

CMD ["node", "server/server.js"]
