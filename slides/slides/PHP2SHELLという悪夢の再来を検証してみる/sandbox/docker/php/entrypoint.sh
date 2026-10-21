#!/bin/sh
set -eu

mkdir -p /var/log/php
chmod 777 /var/log/php

exec /opt/php/sbin/php-fpm -F -y /opt/php/etc/php-fpm.conf -c /opt/php/etc/php.ini
