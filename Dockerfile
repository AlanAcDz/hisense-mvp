FROM node:24-alpine AS react-build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . ./
RUN pnpm build

FROM nginx:1.29.5-alpine

RUN apk add --no-cache openssl curl ca-certificates \
    && curl -L -o /usr/local/bin/mkcert https://dl.filippo.io/mkcert/latest?for=linux/amd64 \
    && chmod +x /usr/local/bin/mkcert \
    && mkdir -p /etc/nginx/certs /etc/nginx/ca

COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=react-build /app/dist/ /usr/share/nginx/html/

RUN chmod +x /docker-entrypoint.sh \
    && chmod -R a+rX /usr/share/nginx/html

CMD ["/docker-entrypoint.sh"]
