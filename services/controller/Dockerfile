FROM python:3.11-slim AS builder
WORKDIR /app
COPY shared/ /app/shared/
COPY db/ /app/db/
COPY kafka_client/ /app/kafka_client/
COPY services/controller/ /app/services/controller/
RUN pip install --no-cache-dir /app/shared /app/db /app/kafka_client /app/services/controller

FROM python:3.11-slim
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
WORKDIR /app
CMD ["python", "-m", "controller.main"]
