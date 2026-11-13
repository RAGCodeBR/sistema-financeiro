FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/nfse ./server/nfse
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY supabase/functions/nfse-fiscal/schemas ./supabase/functions/nfse-fiscal/schemas
ENV NFSE_NODE_HOST=0.0.0.0
ENV PORT=8789
USER node
EXPOSE 8789
CMD ["node","--experimental-strip-types","server/nfse/index.ts"]
