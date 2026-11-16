export interface SiteCredentials {
  username: string;
  applicationPassword: string;
}

export interface WpSyncPluginSettings {
  /** Absolute path to the obsidian-wp-sync monorepo (for CLI spawn). */
  packageRoot: string;
  activeSiteId: string | null;
  credentials: Record<string, SiteCredentials>;
  lastStatus: string;
}

export const DEFAULT_SETTINGS: WpSyncPluginSettings = {
  packageRoot: '',
  activeSiteId: null,
  credentials: {},
  lastStatus: '',
};
