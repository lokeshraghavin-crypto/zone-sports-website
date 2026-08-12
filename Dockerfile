FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# SQLite database file lives here - mount a volume on this path so data
# survives container restarts/redeploys.
VOLUME ["/app/data"]

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "node seed.js; node server.js"]
