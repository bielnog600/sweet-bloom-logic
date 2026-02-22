FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build

EXPOSE 3000
ENV PORT=3000
CMD ["node", ".next/standalone/server.js"]
