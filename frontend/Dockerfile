FROM node:20-alpine AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /usr/src/app
RUN npm install -g serve
COPY --from=build /usr/src/app/dist ./dist
EXPOSE 5180
CMD ["serve", "-s", "dist", "-l", "5180"]
