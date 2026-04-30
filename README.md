## Hisense MVP AR

Frontend React/Vite para la experiencia AR.

### Docker local

La imagen sirve el build estático con nginx y genera un certificado SSL para la IP configurada en `SERVER_IP`.

```sh
docker build -t hisense-mvp-ar .
docker run --rm \
  -p 444:443 \
  -e SERVER_IP=192.168.100.183 \
  -v "../hisense-var/nginx/certs:/etc/nginx/ca:ro" \
  hisense-mvp-ar
```

En el montaje, la AR se sirve desde:

```txt
https://IP_SERVIDOR:444/
```

El certificado CA que se instala en los equipos es el mismo del VAR (`hisense-var/nginx/certs/rootCA.pem`).
