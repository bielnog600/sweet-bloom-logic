FROM node:20-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts=false

COPY . .
RUN npx tsc

EXPOSE 3001
CMD ["node", "dist/index.js"]
