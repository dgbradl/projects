// The structural wall frame around the tavern's edges: four corner pieces and
// four tiling edge strips, cut from the wall-panel art. Purely presentational
// and non-interactive — walls are not movable. Layout, textures, and the
// per-position flips live in tavern.css (.walls / --wall-thickness).
export function Walls() {
  return (
    <div className="walls" data-testid="walls" aria-hidden="true">
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
