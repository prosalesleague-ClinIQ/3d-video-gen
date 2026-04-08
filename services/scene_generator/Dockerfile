FROM python:3.11-slim AS builder
WORKDIR /app
COPY shared/ /app/shared/
COPY db/ /app/db/
COPY kafka_client/ /app/kafka_client/
COPY services/scene_generator/ /app/services/scene_generator/
RUN pip install --no-cache-dir /app/shared /app/db /app/kafka_client /app/services/scene_generator

FROM python:3.11-slim
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
WORKDIR /app
EXPOSE 8000
CMD ["uvicorn", "scene_generator.main:app", "--host", "0.0.0.0", "--port", "8000"]
