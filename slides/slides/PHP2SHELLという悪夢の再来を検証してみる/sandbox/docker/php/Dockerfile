FROM debian:trixie

ARG PHP_VERSION=8.4.4
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential autoconf bison re2c pkg-config ca-certificates curl xz-utils \
      libxml2-dev libsqlite3-dev libssl-dev libcurl4-openssl-dev libonig-dev libzip-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl -fsSL "https://www.php.net/distributions/php-${PHP_VERSION}.tar.gz" -o php.tar.gz \
    && tar xzf php.tar.gz
WORKDIR /src/php-${PHP_VERSION}

RUN ./configure \
      --prefix=/opt/php \
      --disable-all \
      --enable-session \
      --enable-fpm \
      --enable-cli \
      --with-config-file-path=/opt/php/etc \
      --with-fpm-user=www-data \
      --with-fpm-group=www-data \
      CC=gcc \
      CFLAGS="-O1 -g -fsanitize=address -fno-omit-frame-pointer" \
      LDFLAGS="-fsanitize=address" \
    && make -j"$(nproc)" \
    && make install

RUN mkdir -p /var/log/php /web \
    && chown -R www-data:www-data /var/log/php

COPY php-fpm.conf /opt/php/etc/php-fpm.conf
COPY php-on.ini /opt/php/etc/php.ini
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["/entrypoint.sh"]
