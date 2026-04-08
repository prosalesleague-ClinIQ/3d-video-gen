FROM nytimes/blender:4.0-gpu-ubuntu22.04

RUN apt-get update && apt-get install -y python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY shared/ /app/shared/
COPY db/ /app/db/
COPY kafka_client/ /app/kafka_client/
COPY services/blender_worker/ /app/services/blender_worker/

RUN pip3 install --no-cache-dir /app/shared /app/db /app/kafka_client /app/services/blender_worker

CMD ["blender", "--background", "--python", "/app/services/blender_worker/blender_worker/main.py"]
