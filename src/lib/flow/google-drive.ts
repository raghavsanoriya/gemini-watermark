export interface GoogleDriveConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export interface GoogleDriveSelection {
  file: File;
  fileId: string;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface PickerDocument {
  id?: string;
  name?: string;
  mimeType?: string;
}

interface PickerResponse {
  action?: string;
  docs?: PickerDocument[];
}

export function googleAuthorizationError(response: TokenResponse | { type?: string }): Error {
  if ('type' in response) {
    return new Error(response.type === 'popup_closed' ? 'Google authorization was cancelled.' : 'Google authorization failed.');
  }
  const tokenResponse = response as TokenResponse;
  return new Error(tokenResponse.error_description || tokenResponse.error || 'Google authorization was cancelled.');
}

export function pickerDocumentFromResponse(data: PickerResponse): PickerDocument | null {
  if (data.action === 'cancel') throw new Error('Google Drive selection was cancelled.');
  if (data.action !== 'picked') return null;
  const document = data.docs?.[0];
  if (!document?.id) throw new Error('No Google Drive archive was selected.');
  return document;
}

export function driveDownloadError(status: number): Error {
  return status === 401
    ? new Error('Google authorization expired. Reconnect Drive and select the archive again.')
    : new Error(`Google Drive download failed (${status}).`);
}

interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: (error: { type?: string }) => void;
      }) => TokenClient;
    };
  };
  picker: {
    PickerBuilder: new () => {
      setOAuthToken: (token: string) => unknown;
      setDeveloperKey: (key: string) => unknown;
      setAppId: (appId: string) => unknown;
      addView: (view: unknown) => unknown;
      setCallback: (callback: (data: PickerResponse) => void) => unknown;
      setTitle: (title: string) => unknown;
      build: () => { setVisible: (visible: boolean) => void };
    };
    DocsView: new () => {
      setIncludeFolders: (include: boolean) => unknown;
      setSelectFolderEnabled: (enabled: boolean) => unknown;
      setMimeTypes: (mimeTypes: string) => unknown;
    };
  };
}

interface GapiNamespace {
  load: (name: string, options: { callback: () => void; onerror: () => void }) => void;
}

function browserGlobals(): { google?: GoogleNamespace; gapi?: GapiNamespace } {
  return window as typeof window & { google?: GoogleNamespace; gapi?: GapiNamespace };
}

export function getGoogleDriveConfig(): GoogleDriveConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
  return clientId && apiKey && appId ? { clientId, apiKey, appId } : null;
}

function loadScript(src: string, globalReady: () => boolean): Promise<void> {
  if (globalReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src, async: true });
    const onLoad = () => resolve();
    const onError = () => reject(new Error(`Could not load ${new URL(src).hostname}. Check blockers and try again.`));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

async function loadGoogleLibraries(): Promise<GoogleNamespace> {
  await Promise.all([
    loadScript('https://accounts.google.com/gsi/client', () => Boolean(browserGlobals().google?.accounts)),
    loadScript('https://apis.google.com/js/api.js', () => Boolean(browserGlobals().gapi)),
  ]);
  const { gapi } = browserGlobals();
  if (!gapi) throw new Error('Google API could not initialize.');
  await new Promise<void>((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Drive Picker could not initialize.')) }));
  const { google } = browserGlobals();
  if (!google?.accounts || !google.picker) throw new Error('Google Drive libraries are unavailable.');
  return google;
}

function requestAccessToken(google: GoogleNamespace, clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(googleAuthorizationError(response));
      },
      error_callback: (error) => reject(googleAuthorizationError(error)),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

function pickZip(google: GoogleNamespace, config: GoogleDriveConfig, token: string): Promise<PickerDocument> {
  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView();
    view.setIncludeFolders(false);
    view.setSelectFolderEnabled(false);
    view.setMimeTypes('application/zip,application/x-zip-compressed');
    const callback = (data: PickerResponse) => {
      try {
        const document = pickerDocumentFromResponse(data);
        if (document) resolve(document);
      } catch (error) {
        reject(error);
      }
    };
    const builder = new google.picker.PickerBuilder();
    builder.setOAuthToken(token);
    builder.setDeveloperKey(config.apiKey);
    builder.setAppId(config.appId);
    builder.addView(view);
    builder.setTitle('Select an exported Flow ZIP');
    builder.setCallback(callback);
    builder.build().setVisible(true);
  });
}

export function validateDriveArchiveName(name: string, mimeType?: string): void {
  const looksLikeZip = name.toLowerCase().endsWith('.zip')
    || mimeType === 'application/zip'
    || mimeType === 'application/x-zip-compressed';
  if (!looksLikeZip) throw new Error('Choose a ZIP archive exported from Flow or Google Takeout.');
}

async function downloadDriveFile(document: PickerDocument, token: string): Promise<File> {
  const name = document.name || 'flow-export.zip';
  validateDriveArchiveName(name, document.mimeType);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.id!)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw driveDownloadError(response.status);
  const blob = await response.blob();
  return new File([blob], name, { type: 'application/zip', lastModified: Date.now() });
}

export async function selectFlowZipFromDrive(): Promise<GoogleDriveSelection> {
  const config = getGoogleDriveConfig();
  if (!config) {
    throw new Error('Drive import is not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_API_KEY, and NEXT_PUBLIC_GOOGLE_APP_ID, then restart the app.');
  }
  const google = await loadGoogleLibraries();
  const token = await requestAccessToken(google, config.clientId);
  const document = await pickZip(google, config, token);
  const file = await downloadDriveFile(document, token);
  return { file, fileId: document.id! };
}
