FROM node:18-alpine

# Install build tools for sqlite3 build (native dependency compile fallback if needed)
RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

# Run seed before starting
CMD ["sh", "-c", "npm run seed && npm start"]
