import { PromiseDelegate } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import {
  showErrorMessage,
  Dialog,
  Notification,
  ReactWidget,
  showDialog,
} from '@jupyterlab/apputils';

import type { AuthProvider } from '@openeo/js-client';
import { Connection, OpenEO, Process, Service } from '@openeo/js-client';

import TileLayer from 'ol/layer/Tile';
import { XYZ as XYZSource } from 'ol/source';
import { Options as XYZOptions } from 'ol/source/XYZ';
import React from 'react';

import { ensureSaveResult } from './templates';

export interface IOpenEOConnectionInfo {
  /**
   * The url to the open-eo server.
   */
  url?: string;

  /**
   * The session bearer.
   */
  authBearer?: string;
}

const CONNECTIONS: { [serverUrl: string]: Connection } = {};

/**
 * The OpenEO servers we currently hold live connections for, ordered
 * oldest-first (insertion/recency order — see `connect`). Used to
 * populate the server picker in the Add/Edit OpenEO Layer dialog so the
 * user can switch between previously-authenticated servers without
 * signing in again. Global to all documents.
 */
export function listOpenEOConnections(): string[] {
  return Object.keys(CONNECTIONS);
}

/**
 * The most recently used OpenEO connection, or null if none. Used to
 * pre-fill the Add OpenEO Layer dialog so a new layer reuses the server
 * the user last worked with.
 */
export function getLatestOpenEOConnection(): IOpenEOConnectionInfo | null {
  const urls = Object.keys(CONNECTIONS);
  const latest = urls[urls.length - 1];
  return latest ? { url: latest } : null;
}

/**
 * Return the live `Connection` for `serverUrl` if the user is currently
 * signed in to it. Throws otherwise — callers (the tile source, the
 * dialog) are expected to surface the error and re-establish the session
 * (silently from a persisted bearer, or via the sign-in flow).
 */
export function getOpenEOConnection(serverUrl: string): Connection {
  // Match `connect()`'s normalization so cache lookups are consistent.
  let url = serverUrl;
  if (url && !url.match(/^https?:\/\//i)) {
    url = `https://${url}`;
  }
  const connection = CONNECTIONS[url];
  if (!connection) {
    throw new Error(
      `Not connected to OpenEO server "${serverUrl}". Sign in via the "Add OpenEO Layer" dialog or use "Edit OpenEO Layer…" to reconnect.`,
    );
  }
  return connection;
}


export interface IPasswordSignin {
  username: string;
  password: string;
}

export interface IOIDCSignin {
  providerId: string;
}

export interface ISigninBasicProps {
  provider: AuthProvider;
  value: IPasswordSignin;
  onChange: (value: IPasswordSignin) => void;
}

export interface ISigninOIDCProps {
  providers: AuthProvider[];
  value: IOIDCSignin;
  onChange: (value: IOIDCSignin) => void;
}

export function OpenEOSigninBasic({
  provider,
  value,
  onChange
}: ISigninBasicProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minWidth: '320px'
      }}
    >
      <label>
        <div style={{ marginBottom: '4px' }}>Username</div>
        <input
          className="jp-mod-styled"
          type="text"
          value={value.username}
          onChange={event =>
            onChange({ ...value, username: event.target.value })
          }
          style={{ width: '100%' }}
        />
      </label>

      <label>
        <div style={{ marginBottom: '4px' }}>Password</div>
        <input
          className="jp-mod-styled"
          type="password"
          value={value.password}
          onChange={event =>
            onChange({ ...value, password: event.target.value })
          }
          style={{ width: '100%' }}
        />
      </label>
    </div>
  );
}

export function OpenEOSigninOIDC({
  providers,
  value,
  onChange
}: ISigninOIDCProps): React.ReactElement {
  const oidcProviders = providers.filter(
    provider => provider.getType() === 'oidc'
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minWidth: '320px'
      }}
    >
      <label>
        <div style={{ marginBottom: '4px' }}>
          OpenID Connect provider
        </div>
        <select
          className="jp-mod-styled"
          value={value.providerId}
          onChange={event =>
            onChange({
              providerId: event.target.value
            })
          }
          style={{ width: '100%' }}
        >
          <option value="" disabled>
            Select a provider
          </option>
          {oidcProviders.map(provider => (
            <option
              key={provider.getProviderId()}
              value={provider.getProviderId()}
            >
              {provider.getTitle()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

class SigninDialogBody extends ReactWidget {
  private _serverUrl: string;
  private _providers: AuthProvider[];
  private _value: ISigninValues;

  constructor(serverUrl: string, providers: AuthProvider[]) {
    super();
    this._serverUrl = serverUrl;
    this._providers = providers;

    const firstOidc = providers.find(
      provider => provider.getType() === 'oidc'
    );

    this._value = firstOidc
      ? {
          type: 'oidc',
          data: { providerId: firstOidc.getProviderId() }
        }
      : {
          type: 'basic',
          data: {
            username: '',
            password: ''
          }
        };
  }

  getValue(): ISigninValues {
    return this._value;
  }

  protected render(): React.ReactElement {
    return (
      <Signin
        serverUrl={this._serverUrl}
        providers={this._providers}
        value={this._value}
        onChange={value => {
          this._value = value;
          this.update();
        }}
      />
    );
  }
}

export async function showSigninDialog(
  serverUrl: string,
  providers: AuthProvider[]
): Promise<ISigninValues | null> {
  const body = new SigninDialogBody(serverUrl, providers);

  const result = await showDialog({
    title: 'Signin to OpenEO tile server',
    body,
    buttons: [
      Dialog.cancelButton(),
      Dialog.okButton({ label: 'Sign In' })
    ]
  });

  if (!result.button.accept) {
    return null;
  }

  return body.getValue();
}

export async function connect(
  connectionInfo: IOpenEOConnectionInfo,
): Promise<Connection> {
  let { url } = connectionInfo;
  let { authBearer } = connectionInfo;
  // Pre-supplied credentials short-circuit the sign-in dialog — useful
  // when the caller is itself inside another JupyterLab Dialog, since
  // nested showDialog calls queue and never actually display until the
  // outer one closes.
  let signIn: ISigninValues | null = connectionInfo.signIn ?? null;

  // TODO Server URL UI?
  // if (!url) {
  //   signIn = await showSigninDialog(url);

  //   if (!signIn) {
  //     throw new Error('Needs credentials to connect to OpenEO server.');
  //   }

  //   url = signIn.serverUrl;
  // }
  if (!url) {
    throw new Error('No server URL provided');
  }

  if (!url.match(/^https?:\/\//i)) {
    url = `https://${url}`;
  }

  // Already connected to that server url. Re-insert so the cache stays
  // ordered by recency (last key === most recently used), and reflect the
  // resolved url + live bearer back so callers can persist them even when
  // no fresh sign-in happened (otherwise a second layer reusing the cached
  // connection would save a null bearer and prompt on reload).
  if (CONNECTIONS[url]) {
    const existing = CONNECTIONS[url];
    delete CONNECTIONS[url];
    CONNECTIONS[url] = existing;
    connectionInfo.url = url;
    connectionInfo.authBearer = bearerFromConnection(existing) ?? authBearer;
    return existing;
  }

  const errorTitle = 'Failed to connect to the OpenEO server';

  const parsedUrl = new URL(url);
  if (
    window.location.protocol === 'https:' &&
    parsedUrl.protocol !== 'https:'
  ) {
    showErrorMessage(
      errorTitle,
      'You are trying to connect to a server with HTTP instead of HTTPS, which is insecure and prohibited by web browsers. Please use HTTPS instead.',
    );
    throw new Error(errorTitle);
  }

  try {
    const connection = await OpenEO.connect(url, {
      addNamespaceToProcess: true
    });

    // Restore a previously persisted session.
    if (authBearer) {
      const [type, providerId, ...rest] = authBearer.split('/');
      const token = rest.join('/');

      if (type && token) {
        connection.setAuthToken(type, providerId ?? '', token);
      }
    }

    if (!connection.isAuthenticated()) {
      const providers = await connection.listAuthProviders();

      if (!signIn) {
        signIn = await showSigninDialog(url, providers);

        if (!signIn) {
          throw new Error('Needs credentials to connect to OpenEO server.');
        }
      }

      let authProvider: AuthProvider | undefined;

      if (signIn.type === 'basic') {
        authProvider = providers.find(
          provider => provider.getType() === 'basic'
        );

        if (!authProvider) {
          throw new Error('Failed to get "basic" OpenEO provider.');
        }

        await authProvider.login(signIn.data.username, signIn.data.password);
      } else if(signIn.type === 'oidc') {
        const oidcSignin = signIn;

        authProvider = providers.find(
          provider =>
            provider.getType() === 'oidc' &&
            provider.getProviderId() === oidcSignin.data.providerId
        );

        if (!authProvider) {
          throw new Error(
            `Failed to get OIDC provider "${oidcSignin.data.providerId}".`
          );
        }

        await authProvider.login();
      }

      if (!authProvider) {
        throw new Error(`Unknown signin type ${signIn.type}`);
      }

      // Persist the canonical OpenEO bearer representation.
      const token = authProvider.getToken();
      if (token) {
        authBearer = [
          authProvider.getType(),
          authProvider.getProviderId() ?? '',
          token
        ].join('/');
      }
    }

    const serviceTypes = await connection.listServiceTypes();

    // TODO Support other services?
    if (!serviceTypes['XYZ']) {
      throw new Error('We need the OpenEO service to support XYZ tiling.');
    }

    CONNECTIONS[url] = connection;

    // Reflect the resolved server url + live bearer back so callers (the
    // layer dialog) can persist them. The bearer is stored in canonical
    // form so `connect()` can restore the session after a reload (see
    // above).
    connectionInfo.url = url;
    connectionInfo.authBearer = bearerFromConnection(connection) ?? authBearer;

    // NB: we intentionally do NOT emit `openEOEvents.connected` here. A tile
    // source that calls connect() during its own construction renders itself
    // once this resolves; emitting would make mainView rebuild it
    // re-entrantly and fire a duplicate createService. Only promptOpenEOLogin
    // (the sign-in recovery path) emits, to rebuild sources that were waiting.

    return connection;
  } catch (error) {
    showErrorMessage(errorTitle, `${error}`);

    throw error;
  }
}
