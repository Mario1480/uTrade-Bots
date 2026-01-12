FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat

# Enable corepack (npm/pnpm/yarn)
RUN corepack enable

# default
CMD ["sh", "-lc", "node -v && npm -v && sleep infinity"]