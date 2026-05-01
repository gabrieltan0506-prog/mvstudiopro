# Cloud Run Dockerfile for PDF generation microservice
# Multi-stage build: compiles TypeScript in builder stage, runs in slim stage
# Requires Chromium + CJK fonts for correct Chinese rendering

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:18-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.ts ./

RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:18-slim

# Install Chromium and required system libraries
RUN apt-get update && apt-get install -y \
    chromium \
    ghostscript \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libgbm1 \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip bundled Chromium download and use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist/

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
