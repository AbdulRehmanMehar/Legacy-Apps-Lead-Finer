# Stage 1: Build the application
FROM node:22-slim AS builder

# Set working directory
WORKDIR /app

# Install dependencies needed for node-gyp or other build tools if necessary
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the Next.js application
RUN npm run build

# ---

# Stage 2: Run the application
FROM node:22-slim AS runner

# Install Puppeteer/Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Don't download Chromium since we're using the system-installed one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Label the image (optional but helpful)
LABEL maintainer="Antigravity"
LABEL description="Legacy Leads Finder Docker Image"

# Copy package files and install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy the built application from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/lib ./lib

# Copy tsx for running server.ts directly if needed
RUN npm install -g tsx

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["tsx", "server.ts"]
