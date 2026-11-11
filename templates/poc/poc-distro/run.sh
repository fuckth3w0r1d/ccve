#!/bin/sh
set -e
cd "$(dirname "$0")"

trap 'docker compose down -v >/dev/null 2>&1 || true' EXIT

docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --build

i=0
while [ $i -lt 60 ]; do
	if docker compose logs target 2>&1 | grep -q "ready on"; then
		break
	fi
	i=$((i + 1))
	sleep 1
done
if [ $i -ge 60 ]; then
	echo "target did not become ready" >&2
	docker compose logs target >&2
	exit 1
fi

HOSTPORT="${HOSTPORT:?set HOSTPORT to the host port this poc exposes}"
CMD=${CMD:-id > /win.txt}
python3 exp/exploit.py 127.0.0.1 "$HOSTPORT" "$CMD"

echo "--- /win.txt (written by the service inside the target) ---"
docker compose exec -T target cat /win.txt
