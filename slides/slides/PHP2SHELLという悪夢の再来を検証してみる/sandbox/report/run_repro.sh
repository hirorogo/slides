#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p report/evidence

docker compose up -d --build
docker compose --profile cleanup --profile strict --profile php56 up -d php-cleanup php-strict php56
docker compose up -d --force-recreate nginx

i=0
while [ "$i" -lt 30 ]; do
    if curl -fsS http://127.0.0.1:8080/index.php >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 1
done
sleep 2

if ! docker inspect php2shell-apache >/dev/null 2>&1; then
    docker run -d --name php2shell-apache \
        -p 127.0.0.1:8091:80 \
        -v "$PWD/lfi-demo:/var/www/html:ro" \
        -v "$PWD/docker/php/php-on.ini:/usr/local/etc/php/conf.d/zz-php2shell.ini:ro" \
        php:8.4.4-apache
else
    docker start php2shell-apache >/dev/null 2>&1 || true
fi
sleep 2

{
    echo "date_utc: $(date -u)"
    echo "date_jst: $(date)"
    echo "uname: $(uname -a)"
    echo
    docker compose ps
    echo
    docker compose exec -T php-vuln /opt/php/bin/php -v
    docker compose exec -T php-mitigated /opt/php/bin/php -v
    docker compose exec -T php-cleanup /opt/php/bin/php -v
    docker compose exec -T php-strict /opt/php/bin/php -v
    docker exec php2shell-php56-1 php -v
    echo
    curl -sS -I http://127.0.0.1:8080/index.php
} > report/evidence/00_env.txt 2>&1

python3 - "$(uname -n)" <<'PYREDACT'
import pathlib
import sys
host = sys.argv[1]
path = pathlib.Path("report/evidence/00_env.txt")
path.write_text(path.read_text().replace(host, "<hostname>"))
PYREDACT

python3 attacker/attack.py --mode all 2>&1 | tee report/evidence/01_public_poc.txt

python3 attacker/lfi_demo.py 2>&1 | tee report/evidence/02_lfi_cleanup0.txt

python3 attacker/race_demo.py --attempts 3 2>&1 | tee report/evidence/03_race_cleanup1.txt

python3 attacker/upload_include.py 2>&1 | tee report/evidence/04_enabled0_temp_include.txt

(python3 attacker/lfi_demo.py --target http://127.0.0.1:8090/index.php || true) 2>&1 | tee report/evidence/05_strict_chosen_sid.txt

python3 attacker/lfi_demo.py --target http://127.0.0.1:8090/index.php --follow-cookie 2>&1 | tee report/evidence/06_strict_follow_cookie.txt

python3 attacker/lfi_demo.py --target http://127.0.0.1:8091/index.php 2>&1 | tee report/evidence/07_modphp.txt

docker logs php2shell-nginx-1 > report/evidence/08_nginx_access.log 2>&1 || true

docker exec php2shell-php-vuln-1 sh -c 'for f in $(ls -t /tmp/sess_* 2>/dev/null | head -3); do echo "== $f"; cat "$f"; echo; done' > report/evidence/09_session_files_vuln.txt 2>&1 || true
docker exec php2shell-php-cleanup-1 sh -c 'for f in $(ls -t /tmp/sess_* 2>/dev/null | head -3); do echo "== $f"; cat "$f"; echo; done' > report/evidence/10_session_files_cleanup.txt 2>&1 || true
docker exec php2shell-php-strict-1 sh -c 'for f in $(ls -t /tmp/sess_* 2>/dev/null | head -3); do echo "== $f"; cat "$f"; echo; done' > report/evidence/11_session_files_strict.txt 2>&1 || true

docker logs php2shell-apache > report/evidence/12_apache_access.log 2>&1 || true

{
    echo "asan_search:"
    if grep -rl "AddressSanitizer" data/logs 2>/dev/null; then
        echo "FOUND"
    else
        echo "none"
    fi
    echo "php_error:"
    tail -20 data/logs/php-error.log 2>/dev/null || true
    echo "fpm_error:"
    tail -20 data/logs/fpm-error.log 2>/dev/null || true
} > report/evidence/13_asan_check.txt 2>&1

python3 report/build_report.py
echo "done"
