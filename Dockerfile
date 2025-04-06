# Builder stage
FROM node:20-alpine AS build-stage

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies)
RUN npm install

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Install keyv explicitly (fix for cache-manager dependency)
RUN npm install keyv

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application
COPY --from=build-stage /app/dist ./dist

# Copy Prisma client from builder
COPY --from=build-stage /app/node_modules/.prisma/client ./node_modules/.prisma/client

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "run", "start:prod"]
