FROM node:20-alpine
WORKDIR /app
RUN npm install express
COPY src/minimal-server.js ./server.js
EXPOSE 3000
CMD ["node", "server.js"]
