declare module 'turndown-plugin-gfm' {
  import type { Plugin } from 'turndown';

  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  export const highlightedCodeBlock: Plugin;

  const plugin: {
    gfm: Plugin;
    tables: Plugin;
    strikethrough: Plugin;
    taskListItems: Plugin;
    highlightedCodeBlock: Plugin;
  };
  export default plugin;
}
