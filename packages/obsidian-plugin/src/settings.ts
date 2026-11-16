export interface SiteCredentials {
  username: string;
  applicationPassword: string;
}

export interface WpSyncPluginSettings {
  /** Absolute path to the obsidian-wp-sync monorepo (for CLI spawn). */
  packageRoot: string;
  /** Absolute path to node (Obsidian often lacks nvm/Homebrew on PATH). */
  nodePath: string;
  activeSiteId: string | null;
  credentials: Record<string, SiteCredentials>;
  lastStatus: string;
}

export const DEFAULT_SETTINGS: WpSyncPluginSettings = {
  packageRoot: '',
  nodePath: '',
  activeSiteId: null,
  credentials: {},
  lastStatus: '',
};
