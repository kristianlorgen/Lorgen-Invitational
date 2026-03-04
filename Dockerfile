FROM node:22-bookworm-slim

WORKDIR /app

# Viktig: CA-sertifikater for at HTTPS/fetch skal fungere
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates \
     python3 make g++ \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Railway bruker ofte PORT=8080. EXPOSE er mest dokumentasjon, men hold det konsistent.
EXPOSE 8080

CMD ["npm", "run", "start"]
