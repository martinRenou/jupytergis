import {
  ICollaborativeDrive,
  SharedDocumentFactory
} from '@jupyter/docprovider';
import {
  JupyterGISDoc,
  IJGISExternalCommandRegistry,
  IJGISExternalCommandRegistryToken
} from '@jupytergis/schema';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  IThemeManager,
  showErrorMessage,
  WidgetTracker
} from '@jupyterlab/apputils';

import { JupyterGISWidgetFactory } from '@jupytergis/jupytergis-core';
import { IJupyterGISDocTracker, IJupyterGISWidget } from '@jupytergis/schema';
import { requestAPI } from '@jupytergis/base';
import { JupyterGISFCModelFactory } from './modelfactory';

const FACTORY = 'Jupytercad QGIS Factory';

const activate = async (
  app: JupyterFrontEnd,
  tracker: WidgetTracker<IJupyterGISWidget>,
  themeManager: IThemeManager,
  drive: ICollaborativeDrive,
  externalCommandRegistry: IJGISExternalCommandRegistry
): Promise<void> => {
  const fcCheck = await requestAPI<{ installed: boolean }>(
    'jupytergis_qgis/backend-check',
    {
      method: 'POST',
      body: JSON.stringify({})
    }
  );
  const { installed } = fcCheck;
  const backendCheck = () => {
    if (!installed) {
      showErrorMessage(
        'QGIS is not installed',
        'QGIS is required to open QGIS files'
      );
    }
    return installed;
  };
  const widgetFactory = new JupyterGISWidgetFactory({
    name: FACTORY,
    modelName: 'jupytergis-qgismodel',
    fileTypes: ['QGIS'],
    defaultFor: ['QGIS'],
    tracker,
    commands: app.commands,
    externalCommandRegistry,
    backendCheck
  });

  // Registering the widget factory
  app.docRegistry.addWidgetFactory(widgetFactory);

  // Creating and registering the model factory for our custom DocumentModel
  const modelFactory = new JupyterGISFCModelFactory();
  app.docRegistry.addModelFactory(modelFactory);
  // register the filetype
  app.docRegistry.addFileType({
    name: 'QGIS',
    displayName: 'QGIS',
    mimeTypes: ['application/octet-stream'],
    extensions: ['.qgs', '.qgz'],
    fileFormat: 'base64',
    contentType: 'QGIS'
  });

  const QGISSharedModelFactory: SharedDocumentFactory = () => {
    return new JupyterGISDoc();
  };
  drive.sharedModelFactory.registerDocumentFactory(
    'QGIS',
    QGISSharedModelFactory
  );

  widgetFactory.widgetCreated.connect((sender, widget) => {
    // Notify the instance tracker if restore data needs to update.
    widget.context.pathChanged.connect(() => {
      tracker.save(widget);
    });
    themeManager.themeChanged.connect((_, changes) =>
      widget.context.model.themeChanged.emit(changes)
    );

    tracker.add(widget);
    app.shell.activateById('jupytergis::leftControlPanel');
    app.shell.activateById('jupytergis::rightControlPanel');
  });
  console.log('jupytergis:qgisplugin is activated!');
};

export const qgisplugin: JupyterFrontEndPlugin<void> = {
  id: 'jupytergis:qgisplugin',
  requires: [
    IJupyterGISDocTracker,
    IThemeManager,
    ICollaborativeDrive,
    IJGISExternalCommandRegistryToken
  ],
  autoStart: true,
  activate
};
