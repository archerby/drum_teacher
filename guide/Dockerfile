# Варшава без скуки — генератор прогулок (guide.upupa.dev)
# Один маленький контейнер: Node отдаёт статику и ручку /api/mood (Claude, опционально).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/server.mjs ./server/
COPY public ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]
