FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && useradd --create-home --uid 10001 eightlm
COPY app ./app
COPY public ./public
COPY migrations ./migrations
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x scripts/start.sh
USER eightlm
EXPOSE 8000
CMD ["./scripts/start.sh"]
