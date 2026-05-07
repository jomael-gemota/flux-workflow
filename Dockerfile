FROM node:20-alpine AS builder
WORKDIR /app

# Install and build backend
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Install and build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# Place frontend build where the backend will serve it from
RUN cp -r frontend/dist dist/public

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY extension ./extension

EXPOSE 3000

CMD ["node", "dist/index.js"]
