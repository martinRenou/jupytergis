from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from qgis.core import (
    QgsApplication,
    QgsLayerTreeGroup,
    QgsLayerTreeLayer,
    QgsRasterLayer,
    QgsVectorTileLayer,
    QgsProject,
)


def qgis_layer_to_jgis(
    qgis_layer: QgsLayerTreeLayer,
    layers: dict[str, dict[str, Any]],
    sources: dict[str, dict[str, Any]],
) -> str:
    """Load a QGIS layer into the provided layers/sources dictionary in the JGIS format. Returns the layer id or None if enable to load the layer."""
    layer = qgis_layer.layer()
    layer_name = layer.name()
    is_visible = qgis_layer.isVisible()
    layer_type = None
    source_type = None
    layer_parameters = {}
    source_parameters = {}

    if isinstance(layer, QgsRasterLayer):
        layer_type = "RasterLayer"
        source_type = "RasterSource"
        source_params = layer.source().split("&")
        url = ""
        max_zoom = 24
        min_zoom = 0
        for param in source_params:
            if param.startswith("url="):
                url = unquote(param[4:])
            elif param.startswith("zmax="):
                max_zoom = int(param[5:])
            elif param.startswith("zmin="):
                min_zoom = int(param[5:])
        source_parameters.update(
            url=url,
            maxZoom=max_zoom,
            minZoom=min_zoom,
        )

    if isinstance(layer, QgsVectorTileLayer):
        layer_type = "VectorLayer"
        source_type = "VectorTileSource"
        source_params = layer.source().split("&")
        url = ""
        max_zoom = 24
        min_zoom = 0
        for param in source_params:
            if param.startswith("url="):
                url = unquote(param[4:])
            elif param.startswith("zmax="):
                max_zoom = int(param[5:])
            elif param.startswith("zmin="):
                min_zoom = int(param[5:])
        source_parameters.update(
            url=url,
            maxZoom=max_zoom,
            minZoom=min_zoom,
        )

    if layer_type is None:
        print(f"JUPYTERGIS - Enable to load layer type {type(layer)}")
        return

    layer_id = layer.id()
    source_id = str(uuid4())

    layer_parameters = {
        "source": source_id,
    }

    layers[layer_id] = {
        "name": layer_name,
        "parameters": layer_parameters,
        "type": layer_type,
        "visible": is_visible,
    }
    sources[source_id] = {
        "name": f"{layer_name} Source",
        "type": source_type,
        "parameters": source_parameters,
    }

    return layer_id


def qgis_layer_tree_to_jgis(
    node: QgsLayerTreeGroup,
    layer_tree: list | None = None,
    layers: dict[str, dict[str, Any]] | None = None,
    sources: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]] | None:
    if layer_tree is None:
        layer_tree = []
        layers = {}
        sources = {}

    children = node.children()
    for child in children:
        if isinstance(child, QgsLayerTreeGroup):
            _layer_tree = []
            group = {
                "layers": _layer_tree,
                "name": child.name(),
            }
            layer_tree.append(group)
            qgis_layer_tree_to_jgis(child, _layer_tree, layers, sources)
        elif isinstance(child, QgsLayerTreeLayer):
            layer_id = qgis_layer_to_jgis(child, layers, sources)
            if layer_id is not None:
                layer_tree.append(layer_id)

    return {"layers": layers, "sources": sources, "layerTree": layer_tree}


def import_project_from_qgis(path: str | Path):
    if isinstance(path, Path):
        path = str(path)

    # TODO Silent stdout when creating the project?
    project = QgsProject.instance()
    project.read(path)
    layer_tree_root = project.layerTreeRoot()

    jgis_layer_tree = qgis_layer_tree_to_jgis(layer_tree_root)

    # TODO Infer zoom level and center
    # (similar to https://github.com/felt/qgis-plugin/blob/4117a9b118fd6c6b4060738f17ee2be182a3fa4e/felt/core/map_uploader.py#L265)
    # from this:
    # project.viewSettings().defaultViewExtent()

    return {
        "options": {
            "bearing": 0.0,
            "pitch": 0,
            "latitude": 45.3283890632207,
            "longitude": 2.0698449192905173,
            "zoom": 5,
        },
        **jgis_layer_tree,
    }
