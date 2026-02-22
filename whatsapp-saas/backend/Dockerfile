FROM node:20-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts=false

COPY . .
RUN rm -rf dist && npx tsc || (echo "TypeScript compilation failed!" && cat /tmp/*.log 2>/dev/null; exit 1)
RUN ls -la dist/ && ls -la dist/utils/ && ls -la dist/jobs/ && ls -la dist/modules/whatsapp/

EXPOSE 3001
CMD ["node", "dist/index.js"]
