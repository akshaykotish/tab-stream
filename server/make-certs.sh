#!/usr/bin/env bash
# Generate a self-signed cert so the broadcaster page works over HTTPS from any device.
set -e
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem -days 825 \
  -subj "/CN=tab-stream" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${IP}"
echo "Certs created for localhost + ${IP}  ->  https://${IP}:3443/"
