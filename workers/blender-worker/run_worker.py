"""Entrypoint for Blender --background --python. Runs inside Blender's Python."""
import sys
sys.path.insert(0, "/worker")
from app.main import main
main()
