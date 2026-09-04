import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  driveDownloadError,
  getGoogleDriveConfig,
  googleAuthorizationError,
  pickerDocumentFromResponse,
  validateDriveArchiveName,
} from './google-drive';

describe('Google Drive configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stays disabled until all public credentials exist', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', 'key');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '');
    expect(getGoogleDriveConfig()).toBeNull();
  });

  it('returns the complete public Picker configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', 'key');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', 'app');
    expect(getGoogleDriveConfig()).toEqual({ clientId: 'client', apiKey: 'key', appId: 'app' });
  });

  it('rejects non-ZIP Drive selections', () => {
    expect(() => validateDriveArchiveName('flow-project.json', 'application/json')).toThrow(/ZIP archive/);
    expect(() => validateDriveArchiveName('flow-export.zip')).not.toThrow();
  });

  it('reports authorization and Picker cancellation clearly', () => {
    expect(googleAuthorizationError({ type: 'popup_closed' }).message).toMatch(/cancelled/);
    expect(() => pickerDocumentFromResponse({ action: 'cancel' })).toThrow(/cancelled/);
    expect(pickerDocumentFromResponse({ action: 'loaded' })).toBeNull();
    expect(pickerDocumentFromResponse({ action: 'picked', docs: [{ id: 'file-1', name: 'flow.zip' }] })).toMatchObject({ id: 'file-1' });
  });

  it('distinguishes token expiry from a general download failure', () => {
    expect(driveDownloadError(401).message).toMatch(/expired/);
    expect(driveDownloadError(503).message).toContain('503');
  });
});
