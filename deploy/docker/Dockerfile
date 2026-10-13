FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node examples ./examples
RUN mkdir /app/.data && chown node:node /app/.data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/.data
EXPOSE 8787
HEALTHCHECK --interval=20s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.mjs"]
