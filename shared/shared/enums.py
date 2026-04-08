from enum import Enum


class RenderStatus(str, Enum):
    PENDING = "PENDING"
    RENDERING = "RENDERING"
    DONE = "DONE"
    FAILED = "FAILED"
