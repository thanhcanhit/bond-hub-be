# Builder stage
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci && npx prisma generate

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

# Install production dependencies and postgresql-client
RUN apk add --no-cache postgresql-client tini

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy necessary files from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./

# Install only production dependencies and disable prepare script
RUN npm ci --only=production --ignore-scripts

# Set proper permissions
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["npm", "run", "start:prod"]