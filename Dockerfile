FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

ENV PROXY ''
ENV CACHE_DIR '/cache'

VOLUME /cache

EXPOSE 2333
CMD [ "node", "index.js" ]
