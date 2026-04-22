FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Blender 3.6 + Python3 + pip
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        software-properties-common \
        wget \
        xz-utils \
        libgl1-mesa-glx \
        libxi6 \
        libxrender1 \
        libsm6 \
        libxkbcommon0 \
        python3 \
        python3-pip && \
    wget -q https://mirror.clarkson.edu/blender/release/Blender3.6/blender-3.6.0-linux-x64.tar.xz -O /tmp/blender.tar.xz && \
    mkdir -p /opt/blender && \
    tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && \
    rm /tmp/blender.tar.xz && \
    ln -s /opt/blender/blender /usr/local/bin/blender && \
    rm -rf /var/lib/apt/lists/*

# Blender's bundled Python
ENV BLENDER_PYTHON=/opt/blender/3.6/python/bin/python3.10

WORKDIR /worker

COPY requirements.txt .
# Install into system python (for non-bpy deps) AND blender's python
RUN pip3 install --no-cache-dir -r requirements.txt && \
    ${BLENDER_PYTHON} -m ensurepip && \
    ${BLENDER_PYTHON} -m pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY run_worker.py .

ENV BLENDER_USE_GPU=false
ENV BLENDER_ENGINE=CYCLES
ENV BLENDER_SAMPLES=16

CMD ["blender", "--background", "--python", "/worker/run_worker.py"]
