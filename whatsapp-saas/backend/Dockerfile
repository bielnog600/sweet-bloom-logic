FROM node:20-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts=false

COPY . .
RUN rm -rf dist && npx tsc 2>&1; \
    TSC_EXIT=$?; \
    if [ $TSC_EXIT -ne 0 ]; then \
      echo "=== TSC exited with code $TSC_EXIT ==="; \
      echo "=== Checking if dist was partially created ==="; \
      ls -laR dist/ 2>/dev/null || echo "dist/ does not exist"; \
    fi; \
    if [ ! -f dist/index.js ]; then \
      echo "FATAL: dist/index.js not found, build failed"; \
      exit 1; \
    fi
RUN cp -r src/db/migrations dist/db/migrations
RUN ls -la dist/ && ls -la dist/utils/ && ls -la dist/jobs/ && ls -la dist/modules/whatsapp/ && ls -la dist/db/migrations/

EXPOSE 3001
CMD ["node", "dist/index.js"]
