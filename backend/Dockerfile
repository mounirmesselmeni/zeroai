FROM python:3.14-slim

RUN python -m pip install --no-cache-dir uv==0.9.26

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_CACHE_DIR=/root/.cache/uv

EXPOSE 8000
