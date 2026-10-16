# AI-Neurocare Gateway — multi-stage build
# Build:  docker build -t ai-neurocare-gateway .
# Run:    docker run -p 8080:8080 -e GATEWAY_API_KEYS=... ai-neurocare-gateway
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${GATEWAY_PORT:-8080}/health || exit 1
CMD ["node", "dist/main.js"]
