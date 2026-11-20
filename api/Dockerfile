FROM node:20-alpine

WORKDIR /app

# Зависимости отдельным слоем — кэш не сбрасывается при правке кода
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 4000
CMD ["npm", "run", "dev"]
