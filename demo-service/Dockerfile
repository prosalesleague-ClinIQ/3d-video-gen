FROM ubuntu:22.04
# NOTE: For GPU-accelerated Cycles on Hugging Face, switch the base to
# `nvidia/cuda:12.4.1-runtime-ubuntu22.04` and select a GPU HF Space tier.
# The Blender entrypoint will auto-probe OPTIX→CUDA→METAL→HIP→CPU regardless.

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# System deps + Blender runtime libs + ffmpeg + Python
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
        curl \
        xz-utils \
        ffmpeg \
        python3 \
        python3-pip \
        libgl1 \
        libglu1-mesa \
        libxi6 \
        libxrender1 \
        libxrandr2 \
        libxfixes3 \
        libxcursor1 \
        libxcomposite1 \
        libxkbcommon0 \
        libsm6 \
        libxinerama1 \
        libdbus-1-3 \
        libfreetype6 \
        libxml2 \
    && rm -rf /var/lib/apt/lists/*

# Install Blender 4.2 LTS (GPU Cycles + OIDN denoiser)
RUN wget -q https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz -O /tmp/blender.tar.xz && \
    mkdir -p /opt/blender && \
    tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && \
    rm /tmp/blender.tar.xz && \
    ln -s /opt/blender/blender /usr/local/bin/blender

# Verify blender runs
RUN blender --version

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app.py scene_builder.py blender_entrypoint.py video_compose.py image_to_scene.py director_ai.py film_compiler.py ./

# HDRI assets (CC0 Poly Haven). Populated by assets/hdri/fetch.sh before build.
COPY assets ./assets
RUN chmod +x assets/hdri/fetch.sh || true

ENV BLENDER_BIN=/usr/local/bin/blender
ENV VIDEO_DIR=/tmp/videos
ENV FRAMES_DIR=/tmp/frames
ENV HDRI_DIR=/app/assets/hdri
ENV PORT=7860

EXPOSE 7860

CMD ["python3", "app.py"]
