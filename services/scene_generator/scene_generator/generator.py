from shared.schemas import SceneGraph


def build_scene_graph(prompt: str) -> SceneGraph:
    return SceneGraph.from_prompt(prompt)
