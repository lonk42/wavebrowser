# Dev-only image: seeds MongoDB + sample audio for the local compose stack.
FROM node:20-alpine
WORKDIR /seed
RUN npm init -y >/dev/null 2>&1 && npm install mongodb@6 >/dev/null 2>&1
COPY seed.mjs ./
CMD ["node", "seed.mjs"]
