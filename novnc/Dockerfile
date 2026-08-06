FROM ubuntu:22.04

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="WrightTest noVNC" \
      org.opencontainers.image.description="noVNC desktop bridge for headed WrightTest browser recording." \
      org.opencontainers.image.url="https://wrighttest.com" \
      org.opencontainers.image.source="https://github.com/AlexFilippov-it/wrighttest" \
      org.opencontainers.image.documentation="https://github.com/AlexFilippov-it/wrighttest#readme" \
      org.opencontainers.image.licenses="WrightTest Source-Available License v1.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    bash \
    curl \
    dbus-x11 \
    fluxbox \
    novnc \
    tigervnc-common \
    tigervnc-standalone-server \
    xauth \
    xfonts-base \
    websockify \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV DISPLAY=:99
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080

EXPOSE 5900 6080

CMD ["/start.sh"]
