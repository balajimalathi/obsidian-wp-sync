import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SiteRecord } from '../../core/src/sites/registry.js';
import { AddSiteModal } from './AddSiteModal';
import type WpSyncPlugin from './main';

export class WpSyncSettingTab extends PluginSettingTab {
  constructor(private plugin: WpSyncPlugin) {
    super(plugin.app, plugin);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'WP Sync' });

    new Setting(containerEl)
      .setName('Sync package root')
      .setDesc('Absolute path to the obsidian-wp-sync monorepo (contains packages/cli)')
      .addText((t) =>
        t
          .setPlaceholder('/path/to/obsidian-wp-sync')
          .setValue(this.plugin.settings.packageRoot)
          .onChange(async (v) => {
            this.plugin.settings.packageRoot = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    let sites: SiteRecord[] = [];
    try {
      sites = await this.plugin.listVaultSites();
    } catch (err) {
      containerEl.createEl('p', {
        text: `Could not read sites.json: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    new Setting(containerEl)
      .setName('Active site')
      .setDesc('Commands and ribbon actions use this site')
      .addDropdown((d) => {
        d.addOption('', '(none)');
        for (const s of sites) {
          d.addOption(s.id, `${s.name} (${s.id})`);
        }
        d.setValue(this.plugin.settings.activeSiteId ?? '');
        d.onChange(async (v) => {
          this.plugin.settings.activeSiteId = v || null;
          await this.plugin.saveSettings();
        });
      });

    if (this.plugin.settings.lastStatus) {
      containerEl.createEl('p', {
        text: `Last status: ${this.plugin.settings.lastStatus}`,
      });
    }

    containerEl.createEl('h3', { text: 'Sites' });

    new Setting(containerEl).setName('Add site').addButton((b) =>
      b.setButtonText('Add site').setCta().onClick(() => {
        new AddSiteModal(this.plugin).open();
        const timer = window.setInterval(() => {
          if (!document.querySelector('.modal-container')) {
            window.clearInterval(timer);
            void this.display();
          }
        }, 400);
      }),
    );

    for (const site of sites) {
      const hasCreds = Boolean(this.plugin.settings.credentials[site.id]?.applicationPassword);
      new Setting(containerEl)
        .setName(site.name)
        .setDesc(
          `${site.id}\nPublic: ${site.publicSiteUrl}\nWP API: ${site.wpApiUrl}\nCredentials: ${hasCreds ? 'saved' : 'missing'}`,
        )
        .addButton((b) =>
          b.setButtonText('Edit').onClick(() => {
            new AddSiteModal(this.plugin, site).open();
            const timer = window.setInterval(() => {
              if (!document.querySelector('.modal-container')) {
                window.clearInterval(timer);
                void this.display();
              }
            }, 400);
          }),
        )
        .addButton((b) =>
          b.setButtonText('Remove').setWarning().onClick(async () => {
            try {
              await this.plugin.removeVaultSite(site.id);
              new Notice(`Removed site ${site.id} from registry (files kept)`);
              await this.display();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : String(err));
            }
          }),
        );
    }
  }
}
