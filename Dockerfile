FROM node:22-bookworm-slim

WORKDIR /app

# Install system dependencies + CA certificates (fix for HTTPS fetch errors)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Production environment
ENV NODE_ENV=production

# Expose port used by Railway
EXPOSE 3000

# Start server
CMD ["npm", "run", "start"]]
