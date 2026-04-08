# Base image must have Blender installed with bpy accessible.
# Use nytimes/blender or a custom image with blender + Python 3.11.
FROM nytimes/blender:4.0-gpu-ubuntu22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /worker

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# BLENDER_BINARY can be overridden at runtime if the path differs
ENV BLENDER_BINARY=/usr/local/blender/blender

CMD ["blender", "--background", "--python-expr", "import runpy; runpy.run_module('app.main', run_name='__main__')"]
