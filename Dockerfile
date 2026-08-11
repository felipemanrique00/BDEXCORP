FROM node:22.14.0-alpine3.21 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
ARG NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED=false
ENV NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED=${NEXT_PUBLIC_OFFLINE_TRAVEL_ENABLED}
COPY . .
RUN npm run build

FROM node:22.14.0-alpine3.21 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs \
    && mkdir -p /var/lib/bbt/files \
    && chown -R nextjs:nodejs /var/lib/bbt /app
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Next.js standalone tracing can omit Sharp's optional libvips package. Keep the
# musl runtime pair explicit so branding uploads work in the Alpine image.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img/sharp-libvips-linuxmusl-x64 ./node_modules/@img/sharp-libvips-linuxmusl-x64
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img/sharp-linuxmusl-x64 ./node_modules/@img/sharp-linuxmusl-x64
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/deploy/postgres/migrations ./deploy/postgres/migrations
RUN node -e "const sharp = require('sharp'); sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } }).webp().toBuffer().then(() => console.log('sharp runtime ok'))"
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
