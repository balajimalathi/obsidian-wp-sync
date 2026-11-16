import { FuzzySuggestModal } from 'obsidian';
import type { SiteRecord } from '../../core/src/sites/registry.js';
import type WpSyncPlugin from './main';

export class SiteSuggestModal extends FuzzySuggestModal<SiteRecord> {
  constructor(
    private plugin: WpSyncPlugin,
    private sites: SiteRecord[],
    private onChoose: (site: SiteRecord) => void | Promise<void>,
  ) {
    super(plugin.app);
  }

  getItems(): SiteRecord[] {
    return this.sites;
  }

  getItemText(item: SiteRecord): string {
    return `${item.name} (${item.id})`;
  }

  async onChooseItem(item: SiteRecord): Promise<void> {
    await this.onChoose(item);
  }
}
