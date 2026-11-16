import { Menu, Notice, Plugin } from 'obsidian';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  listSites,
  removeSite,
  upsertSite,
  type SiteRecord,
} from '../../core/src/sites/registry.js';
import { AddSiteModal } from './AddSiteModal.js';
import { SiteSuggestModal } from './SiteSuggestModal.js';
import { WpSyncSettingTab } from './SettingsTab.js';
import { envWithNodePath, resolveNodePath } from './resolveNode.js';
import {
  DEFAULT_SETTINGS,
  type WpSyncPluginSettings,
} from './settings.js';

export default class WpSyncPlugin extends Plugin {
  settings: WpSyncPluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new WpSyncSettingTab(this));

    this.addRibbonIcon('sync', 'WP Sync', (evt) => {
      const menu = new Menu();
      menu.addItem((i) =>
        i.setTitle('Bootstrap active site').onClick(() => void this.runCommand('bootstrap')),
      );
      menu.addItem((i) =>
        i.setTitle('Pull from WordPress').onClick(() => void this.runCommand('pull')),
      );
      menu.addItem((i) =>
        i.setTitle('Push to WordPress').onClick(() => void this.runCommand('push')),
      );
      menu.addItem((i) =>
        i.setTitle('Validate vault').onClick(() => void this.runCommand('validate')),
      );
      menu.addSeparator();
      menu.addItem((i) =>
        i.setTitle('Switch active site').onClick(() => void this.switchActiveSite()),
      );
      menu.addItem((i) =>
        i.setTitle('Add site').onClick(() => new AddSiteModal(this).open()),
      );
      menu.addItem((i) =>
        i.setTitle('Open settings').onClick(() => {
          // @ts-expect-error Obsidian internal
          this.app.setting.open();
          // @ts-expect-error Obsidian internal
          this.app.setting.openTabById('obsidian-wp-sync');
        }),
      );
      menu.showAtMouseEvent(evt);
    });

    this.addCommand({
      id: 'bootstrap-active-site',
      name: 'Bootstrap active site',
      callback: () => void this.runCommand('bootstrap'),
    });
    this.addCommand({
      id: 'pull-from-wordpress',
      name: 'Pull from WordPress',
      callback: () => void this.runCommand('pull'),
    });
    this.addCommand({
      id: 'push-to-wordpress',
      name: 'Push to WordPress',
      callback: () => void this.runCommand('push'),
    });
    this.addCommand({
      id: 'validate-vault',
      name: 'Validate vault',
      callback: () => void this.runCommand('validate'),
    });
    this.addCommand({
      id: 'switch-active-site',
      name: 'Switch active site',
      callback: () => void this.switchActiveSite(),
    });
    this.addCommand({
      id: 'add-site',
      name: 'Add site',
      callback: () => new AddSiteModal(this).open(),
    });
  }

  vaultRoot(): string {
    // Desktop adapter exposes basePath
    const adapter = this.app.vault.adapter as { basePath?: string };
    if (!adapter.basePath) {
      throw new Error('Vault base path unavailable (desktop only)');
    }
    return adapter.basePath;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async listVaultSites(): Promise<SiteRecord[]> {
    return listSites(this.vaultRoot());
  }

  async saveSiteFromForm(input: {
    id: string;
    name: string;
    publicSiteUrl: string;
    wpApiUrl: string;
    username: string;
    applicationPassword: string;
  }): Promise<void> {
    if (!input.id || !input.name || !input.publicSiteUrl || !input.wpApiUrl) {
      throw new Error('Name, id, public URL, and WP API URL are required');
    }
    if (!input.username || !input.applicationPassword) {
      throw new Error('WP username and application password are required');
    }
    await upsertSite(this.vaultRoot(), {
      id: input.id,
      name: input.name,
      publicSiteUrl: input.publicSiteUrl,
      wpApiUrl: input.wpApiUrl,
    });
    this.settings.credentials[input.id] = {
      username: input.username,
      applicationPassword: input.applicationPassword,
    };
    if (!this.settings.activeSiteId) {
      this.settings.activeSiteId = input.id;
    }
    await this.saveSettings();
  }

  async removeVaultSite(siteId: string): Promise<void> {
    await removeSite(this.vaultRoot(), siteId, { deleteFiles: false });
    delete this.settings.credentials[siteId];
    if (this.settings.activeSiteId === siteId) {
      this.settings.activeSiteId = null;
    }
    await this.saveSettings();
  }

  async switchActiveSite(): Promise<void> {
    const sites = await this.listVaultSites();
    if (sites.length === 0) {
      new Notice('No sites yet — add one in Settings → WP Sync');
      return;
    }
    new SiteSuggestModal(this, sites, async (site) => {
      this.settings.activeSiteId = site.id;
      await this.saveSettings();
      new Notice(`Active site: ${site.name}`);
    }).open();
  }

  async runCommand(command: 'bootstrap' | 'pull' | 'push' | 'validate'): Promise<void> {
    const siteId = this.settings.activeSiteId;
    if (!siteId) {
      new Notice('No active site — add/select one in Settings → WP Sync');
      return;
    }
    const creds = this.settings.credentials[siteId];
    if (!creds?.username || !creds.applicationPassword) {
      new Notice(`Missing credentials for ${siteId}`);
      return;
    }
    const sites = await this.listVaultSites();
    const site = sites.find((s) => s.id === siteId);
    if (!site) {
      new Notice(`Site ${siteId} not in registry`);
      return;
    }
    if (!this.settings.packageRoot) {
      new Notice('Set Sync package root in Settings → WP Sync');
      return;
    }

    new Notice(`WP Sync: ${command} ${siteId}…`);
    try {
      const output = await this.spawnWpSync(command, site, creds);
      this.settings.lastStatus = `${command} ${siteId} OK`;
      await this.saveSettings();
      new Notice(`WP Sync: ${command} done`);
      console.log(`[wp-sync] ${output}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.settings.lastStatus = `${command} ${siteId} failed: ${message.slice(0, 200)}`;
      await this.saveSettings();
      new Notice(`WP Sync failed: ${message.slice(0, 180)}`);
      console.error('[wp-sync]', err);
    }
  }

  private spawnWpSync(
    command: string,
    site: SiteRecord,
    creds: { username: string; applicationPassword: string },
  ): Promise<string> {
    const packageRoot = this.settings.packageRoot;
    const vault = this.vaultRoot();
    const nodePath = resolveNodePath(this.settings.nodePath);
    const cliEntry = path.join(packageRoot, 'packages/cli/src/index.ts');
    if (!existsSync(cliEntry)) {
      throw new Error(`CLI not found at ${cliEntry}. Check Sync package root.`);
    }

    // Prefer local tsx so we don't depend on npm being on PATH.
    const tsxCandidates = [
      path.join(packageRoot, 'node_modules/tsx/dist/loader.mjs'),
      path.join(packageRoot, 'packages/cli/node_modules/tsx/dist/loader.mjs'),
    ];
    const tsxLoader = tsxCandidates.find((p) => existsSync(p));
    if (!tsxLoader) {
      throw new Error(
        `tsx not found under ${packageRoot}. Run npm install in the sync package root.`,
      );
    }

    const args = [
      '--import',
      tsxLoader,
      cliEntry,
      command,
      '--site',
      site.id,
      '--vault',
      vault,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(nodePath, args, {
        cwd: packageRoot,
        env: envWithNodePath(nodePath, {
          PUBLIC_SITE_URL: site.publicSiteUrl,
          WP_API_URL: site.wpApiUrl,
          WP_USERNAME: creds.username,
          WP_APPLICATION_PASSWORD: creds.applicationPassword,
          VAULT_PATH: vault,
        }),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(stdout || stderr);
        else reject(new Error(stderr || stdout || `exit ${code}`));
      });
    });
  }
}
