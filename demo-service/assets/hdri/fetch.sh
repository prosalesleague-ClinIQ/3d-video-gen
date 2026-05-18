#!/usr/bin/env bash
# Downloads 4 CC0 Poly Haven HDRIs (1k) for Blender world IBL.
# Run this before `docker build` so the HDRIs land inside the image.
set -e
cd "$(dirname "$0")"
echo "Fetching Poly Haven HDRIs (CC0)…"
curl -L -o studio.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_08_1k.hdr
curl -L -o sunset.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_1_dawn_1k.hdr
curl -L -o night.hdr  https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr
curl -L -o forest.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/symmetrical_garden_02_1k.hdr
echo "Done. Files: $(ls -lh *.hdr 2>/dev/null | wc -l)"
