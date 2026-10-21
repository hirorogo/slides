#!/bin/sh
set -eu

cd "$(dirname "$0")"

docker compose up -d --build

i=0
while [ "$i" -lt 60 ]; do
    if curl -fsS http://127.0.0.1:8080/index.php >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 2
done

if [ "$i" -eq 60 ]; then
    echo "lab did not become ready" >&2
    docker compose ps >&2
    exit 1
fi

python3 attacker/attack.py --mode all --save-raw
