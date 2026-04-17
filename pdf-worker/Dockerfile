# Cloud Run Dockerfile for PDF generation microservice
# Requires Chromium + CJK fonts for correct Chinese rendering

FROM node:18-slim

# Install Chromium and required system libraries
RUN apt-get update && apt-get install -y \
    chromium \
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
    # CJK fonts to prevent Chinese character garbling
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip bundled Chromium download and use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json ./

# Install production dependencies only
RUN npm install --production

# Copy compiled JS (build before docker build: npm run build)
COPY dist/ ./dist/

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
