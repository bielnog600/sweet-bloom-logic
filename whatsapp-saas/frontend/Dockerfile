FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build

# Standalone needs static files copied manually
RUN cp -r .next/static .next/standalone/.next/static
RUN if [ -d "public" ]; then cp -r public .next/standalone/public; fi

EXPOSE 3000
CMD ["sh", "-c", "PORT=3000 node .next/standalone/server.js"]
