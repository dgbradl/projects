// Auto-discovered catalog of the cut tavern sprites
// (assets/tavern/<category>/<name>.png) — new cuts appear with no code change.
const modules = import.meta.glob('./tavern/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface SpriteAsset {
  name: string;
  category: string;
  url: string;
}

export const tavernSprites: SpriteAsset[] = Object.entries(modules)
  .map(([path, url]) => {
    const parts = path.split('/');
    return {
      category: parts[parts.length - 2],
      name: parts[parts.length - 1].replace(/\.png$/, ''),
      url: String(url),
    };
  })
  .sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );

export const tavernSpritesByCategory: [string, SpriteAsset[]][] = (() => {
  const groups = new Map<string, SpriteAsset[]>();
  for (const sprite of tavernSprites) {
    const list = groups.get(sprite.category) ?? [];
    list.push(sprite);
    groups.set(sprite.category, list);
  }
  return [...groups.entries()];
})();
