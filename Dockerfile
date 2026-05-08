FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-alpine
WORKDIR /app

# ImageMagick + Ghostscript for PDF-to-image conversion (vision fallback)
RUN apk add --no-cache imagemagick ghostscript

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# config.yaml is expected to be mounted at /app/config.yaml
# (or override path via CONFIG_PATH env var)
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "dist/index.js", "web"]
