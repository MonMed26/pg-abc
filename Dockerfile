# syntax=docker/dockerfile:1.7

# ======================================================================
# BCA Merchant QRIS Mini Payment Gateway
# ----------------------------------------------------------------------
# Base: official Playwright image (Ubuntu Jammy + Node 20 + Chromium +
# all system libs preinstalled). Versi Playwright di image HARUS sama
# dengan versi di package-lock.json.
# ======================================================================
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Metadata
LABEL org.opencontainers.image.title="bca-merchant-qris-gateway" \
      org.opencontainers.image.description="Unofficial BCA QRIS Merchant mini payment gateway" \
      org.opencontainers.image.source="https://github.com/MonMed26/pg-abc"

WORKDIR /app

# --- Dependencies ---
# Copy package files dulu biar layer npm ci ke-cache saat source berubah.
COPY package.json package-lock.json ./

# Install hanya production deps. Sisakan build tools karena better-sqlite3
# perlu compile native binding via node-gyp.
# Playwright base image sudah punya python3 + make + g++ via build-essential.
# Kita drop PW download browser di sini karena binary-nya sudah ada di base image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev \
  && npm cache clean --force

# --- Source ---
COPY src ./src
COPY public ./public

# --- Data dir (persistent volume target) ---
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app

# Run sebagai user non-root yang sudah disediakan Playwright image
USER pwuser

ENV NODE_ENV=production \
    PORT=3000 \
    HEADLESS=true \
    SESSION_FILE=/app/data/session.json \
    DB_PATH=/app/data/payments.db

EXPOSE 3000

# Volume untuk persist session + db antar container restart.
VOLUME ["/app/data"]

# Healthcheck: ping /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
