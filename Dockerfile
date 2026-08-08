FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci
COPY server/ ./
COPY --from=web-build /app/web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
