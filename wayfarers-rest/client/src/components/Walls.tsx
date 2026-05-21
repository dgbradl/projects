// The structural wall frame around the tavern's edges: a dark wall-surface
// fill that gives the wall its mass, trimmed at the outer rim by four corner
// pieces and four tiling edge strips cut from the wall-panel art. Purely
// presentational and non-interactive — walls are not movable. Layout,
// textures, and per-position flips live in tavern.css
// (.walls / --wall-thickness / --wall-depth).
export function Walls() {
  return (
    <div className="walls" data-testid="walls" aria-hidden="true">
      <div className="wall wall-fill wall-fill-top" />
      <div className="wall wall-fill wall-fill-bottom" />
      <div className="wall wall-fill wall-fill-left" />
      <div className="wall wall-fill wall-fill-right" />
      <div className="wall wall-edge wall-edge-top" />
      <div className="wall wall-edge wall-edge-bottom" />
      <div className="wall wall-edge wall-edge-left" />
      <div className="wall wall-edge wall-edge-right" />
      <div className="wall wall-corner wall-corner-tl" />
      <div className="wall wall-corner wall-corner-tr" />
      <div className="wall wall-corner wall-corner-bl" />
      <div className="wall wall-corner wall-corner-br" />
    </div>
  );
}
