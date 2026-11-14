FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build && node scripts/download-circuits.mjs
EXPOSE 8080
CMD ["node", "dist/server.js"]
