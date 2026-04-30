#!/bin/sh
set -e

mkdir -p /etc/nginx/certs

if [ -z "$SERVER_IP" ]; then
  echo "ERROR: SERVER_IP no esta definido"
  exit 1
fi

if [ ! -f /etc/nginx/ca/rootCA.pem ]; then
  echo "ERROR: No existe /etc/nginx/ca/rootCA.pem"
  exit 1
fi

if [ ! -f /etc/nginx/ca/rootCA-key.pem ]; then
  echo "ERROR: No existe /etc/nginx/ca/rootCA-key.pem"
  exit 1
fi

export CAROOT=/etc/nginx/ca

echo "Generando certificado SSL para AR con IP: ${SERVER_IP}"

mkcert \
  -cert-file /etc/nginx/certs/cert.pem \
  -key-file /etc/nginx/certs/key.pem \
  "${SERVER_IP}"

openssl x509 \
  -in /etc/nginx/certs/cert.pem \
  -text \
  -noout | grep -A2 "Subject Alternative Name" || {
    echo "ERROR: El certificado no contiene Subject Alternative Name"
    exit 1
  }

sed -i "s|{{SERVER_IP}}|${SERVER_IP}|g" /etc/nginx/conf.d/default.conf

echo "Iniciando Nginx AR..."

nginx -g 'daemon off;'
