import {
  IJGISLayersGroup,
  IJGISLayersTree,
  IJupyterGISModel
} from '@jupytergis/schema';
import {
  Button,
  LabIcon,
  ReactWidget,
  caretDownIcon
} from '@jupyterlab/ui-components';
import { ISignal, Signal } from '@lumino/signaling';
import { Panel } from '@lumino/widgets';
import React, { useEffect, useState } from 'react';
import { nonVisibilityIcon, rasterIcon, visibilityIcon } from '../../icons';

const LAYERS_PANEL_CLASS = 'jp-gis-layerPanel';
const LAYERS_GROUP_CLASS = 'jp-gis-layersGroup';
const LAYERS_GROUP_HEADER_CLASS = 'jp-gis-layersGroupHeader';
const LAYERS_GROUP_COLLAPSER_CLASS = 'jp-gis-layersGroupCollapser';
const LAYER_ITEM_CLASS = 'jp-gis-layerItem';
const LAYER_CLASS = 'jp-gis-layer';
const LAYER_TITLE_CLASS = 'jp-gis-layerTitle';
const LAYER_ICON_CLASS = 'jp-gis-layerIcon';

/**
 * The namespace for the layers panel.
 */
export namespace LayersPanel {
  /**
   * Options of the layers panel widget.
   */
  export interface IOptions {
    model: IJupyterGISModel | undefined;
  }
}

/**
 * The layers panel widget.
 */
export class LayersPanel extends Panel {
  constructor(options: LayersPanel.IOptions) {
    super();
    this._model = options.model;
    this.id = 'jupytergis::layersTree';
    this.addClass(LAYERS_PANEL_CLASS);
    this.addWidget(
      ReactWidget.create(
        <LayersBodyComponent
          model={this._model}
          modelChanged={this._modelChanged}
          onSelect={this._onSelect}
        ></LayersBodyComponent>
      )
    );
  }

  /**
   * Set the GIS model associated to the widget.
   */
  set model(value: IJupyterGISModel | undefined) {
    this._model = value;
    this._modelChanged.emit(value);
  }

  /**
   * A signal emitting when the GIS model changed.
   */
  get modelChanged(): ISignal<LayersPanel, IJupyterGISModel | undefined> {
    return this._modelChanged;
  }

  /**
   * Function to call when a layer is selected from a component of the panel.
   *
   * @param layer - the selected layer.
   */
  private _onSelect = (layer?: string) => {
    if (this._model) {
      this._model.currentLayer = layer ?? null;
    }
  };

  private _model: IJupyterGISModel | undefined;
  private _modelChanged = new Signal<LayersPanel, IJupyterGISModel | undefined>(
    this
  );
}

/**
 * Properties of the layers body component.
 */
interface IBodyProps extends LayersPanel.IOptions {
  modelChanged: ISignal<LayersPanel, IJupyterGISModel | undefined>;
  onSelect: (layer?: string) => void;
}

/**
 * The body component of the panel.
 */
function LayersBodyComponent(props: IBodyProps): JSX.Element {
  const [model, setModel] = useState<IJupyterGISModel | undefined>(props.model);
  const [layersTree, setLayersTree] = useState<IJGISLayersTree>(
    model?.getLayersTree() || []
  );

  /**
   * Propagate the layer selection.
   */
  const onItemClick = (item?: string) => {
    props.onSelect(item);
  };

  /**
   * Listen to the layers and layers tree changes.
   */
  useEffect(() => {
    const updateLayers = () => {
      setLayersTree(model?.getLayersTree() || []);
    };
    model?.sharedModel.layersChanged.connect(updateLayers);
    model?.sharedModel.layersTreeChanged.connect(updateLayers);

    return () => {
      model?.sharedModel.layersChanged.disconnect(updateLayers);
      model?.sharedModel.layersTreeChanged.disconnect(updateLayers);
    };
  }, [model]);

  /**
   * Update the model when it changes.
   */
  props.modelChanged.connect((_, model) => {
    setModel(model);
    setLayersTree(model?.getLayersTree() || []);
  });

  return (
    <div>
      {layersTree.map(layer =>
        typeof layer === 'string' ? (
          <LayerComponent model={model} layerId={layer} onClick={onItemClick} />
        ) : (
          <LayersGroupComponent
            model={model}
            group={layer}
            onClick={onItemClick}
          />
        )
      )}
    </div>
  );
}

/**
 * Properties of the layers group component.
 */
interface ILayersGroupProps extends LayersPanel.IOptions {
  group: IJGISLayersGroup | undefined;
  onClick: (item?: string) => void;
}

/**
 * The component to handle group of layers.
 */
function LayersGroupComponent(props: ILayersGroupProps): JSX.Element {
  const { group, model } = props;
  if (group === undefined) {
    return <></>;
  }
  const [open, setOpen] = useState<boolean>(false);
  const name = group?.name ?? 'Undefined group';
  const layers = group?.layers ?? [];

  return (
    <div className={`${LAYER_ITEM_CLASS} ${LAYERS_GROUP_CLASS}`}>
      <div onClick={() => setOpen(!open)} className={LAYERS_GROUP_HEADER_CLASS}>
        <LabIcon.resolveReact
          icon={caretDownIcon}
          className={
            LAYERS_GROUP_COLLAPSER_CLASS + (open ? ' jp-mod-expanded' : '')
          }
          tag={'span'}
        />
        <span>{name}</span>
      </div>
      {open && (
        <div>
          {layers.map(layer =>
            typeof layer === 'string' ? (
              <LayerComponent
                model={model}
                layerId={layer}
                onClick={props.onClick}
              />
            ) : (
              <LayersGroupComponent
                model={model}
                group={layer}
                onClick={props.onClick}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Properties of the layer component.
 */
interface ILayerProps extends LayersPanel.IOptions {
  layerId: string;
  onClick: (item?: string) => void;
}

/**
 * The component to display a single layer.
 */
function LayerComponent(props: ILayerProps): JSX.Element {
  const { layerId, model } = props;
  const layer = model?.getLayer(layerId);
  if (layer === undefined) {
    return <></>;
  }
  const [selected, setSelected] = useState<boolean>(
    model?.currentLayer === layerId
  );
  const name = layer.name;

  /**
   * Listen to the changes on the current layer.
   */
  useEffect(() => {
    const isSelected = () => {
      setSelected(model?.currentLayer === layerId);
    };
    model?.currentLayerChanged.connect(isSelected);

    return () => {
      model?.currentLayerChanged.disconnect(isSelected);
    };
  }, [model]);

  /**
   * Toggle layer visibility.
   */
  const toggleVisibility = () => {
    layer.visible = !layer.visible;
    model?.sharedModel.updateLayer(layerId, layer);
  };

  return (
    <div
      className={`${LAYER_ITEM_CLASS} ${LAYER_CLASS}${selected ? ' jp-mod-selected' : ''}`}
    >
      <div className={LAYER_TITLE_CLASS} onClick={() => props.onClick(layerId)}>
        {layer.type === 'RasterLayer' && (
          <LabIcon.resolveReact
            icon={rasterIcon}
            className={LAYER_ICON_CLASS}
          />
        )}
        <span>{name}</span>
      </div>
      <Button
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={toggleVisibility}
        minimal
      >
        <LabIcon.resolveReact
          icon={layer.visible ? visibilityIcon : nonVisibilityIcon}
          className={LAYER_ICON_CLASS}
          tag="span"
        />
      </Button>
    </div>
  );
}
