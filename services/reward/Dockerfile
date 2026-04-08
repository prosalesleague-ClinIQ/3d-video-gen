FROM python:3.11-slim AS builder
RUN apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared/ /app/shared/
COPY db/ /app/db/
COPY kafka_client/ /app/kafka_client/
COPY services/reward/ /app/services/reward/
RUN pip install --no-cache-dir /app/shared /app/db /app/kafka_client /app/services/reward

FROM python:3.11-slim
RUN apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
WORKDIR /app
CMD ["python", "-m", "reward.main"]
