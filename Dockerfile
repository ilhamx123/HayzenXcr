FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node scripts/download-circuits.mjs && npm prune --omit=dev
EXPOSE 8080
CMD ["node", "dist/server.js"]
