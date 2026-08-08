# backend/frontend ともに npm 依存パッケージを持たないため、npm install は不要（CLAUDE.md 参照）。
FROM node:20.19-alpine

WORKDIR /app

COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=3101
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+(process.env.PORT||3101)+'/healthz',(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "backend/index.js"]
