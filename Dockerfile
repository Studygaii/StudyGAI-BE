# Dockerfile for StudyGAI Backend (NestJS)
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

EXPOSE 4000
CMD ["node", "dist/main.js"]
