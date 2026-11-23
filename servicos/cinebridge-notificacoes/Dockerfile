# Imagem do cinebridge-notificacoes (porta 3003). Multi-stage: o estagio "build" compila o TypeScript com as
# devDependencies; o estagio final leva so dist/ e as dependencias de producao.
FROM node:22-alpine AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /usr/src/app
# curl: usado pelo healthcheck do docker-compose (curl -f http://localhost:3003/health)
RUN apk add --no-cache curl
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /usr/src/app/dist ./dist
EXPOSE 3003
USER node
CMD ["node", "dist/main.js"]
