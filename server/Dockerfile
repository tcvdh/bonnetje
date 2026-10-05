FROM python:3.14-slim
# Links the package to the repository, so on GHCR it shows the source and inherits the repository's visibility.
LABEL org.opencontainers.image.source="https://github.com/tcvdh/bonnetje" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.title="Bonnetje server"
WORKDIR /app
COPY server.py tenants.py limiter.py admin.py scanning.py scan_prompt.txt entrypoint.sh ./
COPY static/ static/
COPY admin/ admin/
# The server runs as an unprivileged user (uid 10001). entrypoint.sh starts as root only to hand /data to that
# user (so data from older images keeps working), then drops every privilege before the server starts.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin bonnetje && chmod +x entrypoint.sh
# The admin dashboard (off unless RECEIPT_ADMIN_PORT + RECEIPT_ADMIN_KEY are set) listens on all interfaces; publish
# its port to your LAN only and never forward it to the internet (see compose.yml).
ENV RECEIPT_DATA_DIR=/data PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import urllib.request as u; u.urlopen('http://127.0.0.1:3000/api/health', timeout=4)"
ENTRYPOINT ["./entrypoint.sh"]
CMD ["python3", "server.py"]
