FROM node:20-alpine AS build
WORKDIR /app
# Движку Prisma на Alpine нужен OpenSSL — без него он падает с "Error: Could not
# parse schema engine response" при генерации клиента и при миграциях.
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY src/templates/views ./dist/templates/views
COPY public ./public

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server/index.js"]
