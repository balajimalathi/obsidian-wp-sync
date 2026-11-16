import { Modal, Notice, Setting } from 'obsidian';
import type WpSyncPlugin from './main';

export class AddSiteModal extends Modal {
  private name = '';
  private id = '';
  private publicSiteUrl = '';
  private wpApiUrl = '';
  private username = '';
  private applicationPassword = '';
  private editingId: string | null = null;

  constructor(
    private plugin: WpSyncPlugin,
    existing?: {
      id: string;
      name: string;
      publicSiteUrl: string;
      wpApiUrl: string;
    },
  ) {
    super(plugin.app);
    if (existing) {
      this.editingId = existing.id;
      this.id = existing.id;
      this.name = existing.name;
      this.publicSiteUrl = existing.publicSiteUrl;
      this.wpApiUrl = existing.wpApiUrl;
      const creds = plugin.settings.credentials[existing.id];
      this.username = creds?.username ?? '';
      this.applicationPassword = creds?.applicationPassword ?? '';
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', {
      text: this.editingId ? 'Edit site' : 'Add site',
    });

    new Setting(contentEl).setName('Display name').addText((t) =>
      t.setValue(this.name).onChange((v) => {
        this.name = v;
        if (!this.editingId && !this.id) {
          this.id = slugify(v);
        }
      }),
    );

    new Setting(contentEl)
      .setName('Site id')
      .setDesc('Folder name under sites/ (lowercase, hyphens). Fixed after create.')
      .addText((t) => {
        t.setValue(this.id).setDisabled(Boolean(this.editingId)).onChange((v) => {
          this.id = v.trim().toLowerCase();
        });
      });

    new Setting(contentEl)
      .setName('Public site URL')
      .setDesc('Consumer site crawled for structure (e.g. https://jsontoimg.com)')
      .addText((t) =>
        t.setValue(this.publicSiteUrl).onChange((v) => {
          this.publicSiteUrl = v.trim();
        }),
      );

    new Setting(contentEl)
      .setName('WordPress API URL')
      .setDesc('REST origin (e.g. https://blog.skndan.com/jsontoimg)')
      .addText((t) =>
        t.setValue(this.wpApiUrl).onChange((v) => {
          this.wpApiUrl = v.trim();
        }),
      );

    new Setting(contentEl)
      .setName('WP username')
      .setDesc('Stored only in plugin data (not in the vault)')
      .addText((t) =>
        t.setValue(this.username).onChange((v) => {
          this.username = v.trim();
        }),
      );

    new Setting(contentEl)
      .setName('Application password')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setValue(this.applicationPassword).onChange((v) => {
          this.applicationPassword = v.trim();
        });
      });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.editingId ? 'Save' : 'Add site')
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.saveSiteFromForm({
              id: this.id,
              name: this.name,
              publicSiteUrl: this.publicSiteUrl,
              wpApiUrl: this.wpApiUrl,
              username: this.username,
              applicationPassword: this.applicationPassword,
            });
            new Notice(`Saved site ${this.id}`);
            this.close();
          } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err));
          }
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
