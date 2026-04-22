FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# System deps + Blender runtime libs + ffmpeg + Python
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
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

# Install Blender 3.6 LTS (known-stable for bpy scripting)
RUN wget -q https://download.blender.org/release/Blender3.6/blender-3.6.15-linux-x64.tar.xz -O /tmp/blender.tar.xz && \
    mkdir -p /opt/blender && \
    tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && \
    rm /tmp/blender.tar.xz && \
    ln -s /opt/blender/blender /usr/local/bin/blender

# Verify blender runs
RUN blender --version

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app.py scene_builder.py blender_entrypoint.py video_compose.py ./

ENV BLENDER_BIN=/usr/local/bin/blender
ENV VIDEO_DIR=/tmp/videos
ENV FRAMES_DIR=/tmp/frames
ENV PORT=7860

EXPOSE 7860

CMD ["python3", "app.py"]
