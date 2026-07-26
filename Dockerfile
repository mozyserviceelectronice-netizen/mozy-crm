FROM node:22-alpine AS dependencies

WORKDIR /app

RUN apk add --no-cache font-dejavu

COPY package*.json ./

RUN npm ci --omit=dev

RUN mkdir -p /app/data && chown node:node /app/data

FROM dependencies AS test

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node tests ./tests

USER node

RUN npm test

FROM dependencies AS runtime

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
