#!/bin/sh
set -eu
python -m app.db.migrate
exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log
