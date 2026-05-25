import {
  tavernSprites,
  tavernSpritesByCategory,
} from '../../assets/tavernSprites.ts';

/** Build tab: drag-source palette of every tavern sprite. The drop target is
 *  the tavern <Furnishings> layer; payload is the sprite name. */
export function SpriteGallerySection() {
  return (
    <details open data-testid="debug-sprites">
      <summary>sprite gallery ({tavernSprites.length})</summary>
      {tavernSpritesByCategory.map(([category, sprites]) => (
        <div key={category} className="sprite-group">
          <div className="sprite-group-label">
            <span className="debug-key">{category}</span>{' '}
            <span className="debug-dim">({sprites.length})</span>
          </div>
          <div className="sprite-grid">
            {sprites.map((sprite) => (
              <div
                key={sprite.name}
                className="sprite-cell"
                title={sprite.name}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', sprite.name);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <img
                  src={sprite.url}
                  alt={sprite.name}
                  loading="lazy"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </details>
  );
}
