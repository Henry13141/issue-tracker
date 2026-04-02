FROM node:22-alpine
WORKDIR /app
# 国内构建时 npm 默认源可能较慢，构建阶段走 npmmirror
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
EXPOSE 9000
USER node
CMD ["node", "server.mjs"]
