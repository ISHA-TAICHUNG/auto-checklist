FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY fixtures ./fixtures

CMD ["node", "src/index.js"]
