FROM node:lts-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 2333
CMD [ "node", "index.js" ]
