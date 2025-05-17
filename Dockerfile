# Builder stage
FROM node:20-alpine AS build-stage

WORKDIR /app

# Install Python and other build dependencies with virtual environment setup
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    linux-headers \
    build-base \
    python3-dev \
    libc6-compat \
    git \
    && python3 -m venv /opt/venv \
    && . /opt/venv/bin/activate \
    && pip install --upgrade pip \
    && pip install invoke

# Set environment variables to use the virtual environment
ENV PATH="/opt/venv/bin:$PATH"

# Copy package files and install dependencies without mediasoup
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts && \
    npm install --no-save typescript ts-node && \
    npm rebuild bcrypt --build-from-source && \
    npm install mediasoup@3.15.7 --build-from-source --verbose

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build application
COPY . .
RUN npm run build && ls -la dist

# Production stage
FROM node:20-alpine AS production

# Install PostgreSQL client, cron, and build dependencies
RUN apk add --no-cache \
    postgresql-client \
    python3 \
    py3-pip \
    make \
    g++ \
    linux-headers \
    cronie \
    build-base \
    python3-dev \
    libc6-compat \
    git \
    && python3 -m venv /opt/venv \
    && . /opt/venv/bin/activate \
    && pip install --upgrade pip \
    && pip install invoke

# Set environment variables to use the virtual environment
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install -g husky && \
    npm install --omit=dev && \
    npm install -g ts-node typescript && \
    npm rebuild bcrypt --build-from-source && \
    npm install mediasoup@3.15.7 --build-from-source --verbose

# Copy Prisma files
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application from builder
COPY --from=build-stage /app/dist ./dist
COPY --from=build-stage /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build-stage /app/node_modules/mediasoup ./node_modules/mediasoup

# Copy necessary TypeScript type definitions
COPY --from=build-stage /app/node_modules/@types ./node_modules/@types

# Copy additional required dependencies
COPY --from=build-stage /app/node_modules/@nestjs ./node_modules/@nestjs
COPY --from=build-stage /app/node_modules/keyv ./node_modules/keyv
COPY --from=build-stage /app/node_modules/json-buffer ./node_modules/json-buffer
COPY --from=build-stage /app/node_modules/cache-manager ./node_modules/cache-manager

# Create a custom package.json for production
RUN echo '{"name":"vodka","version":"0.0.1","scripts":{"start":"node dist/src/main.js","start:prod":"node dist/src/main.js","db:migrate":"prisma migrate deploy","db:seed":"prisma db seed","db:setup":"npm run db:migrate"},"prisma":{"seed":"ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"}}' > package.json

# Copy seed data and TypeScript config
COPY --from=build-stage /app/prisma/seed.ts ./prisma/
COPY --from=build-stage /app/tsconfig.json ./

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
