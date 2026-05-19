import { useEffect, useState } from 'react';
import { useStore } from '../state/store.tsx';

/**
 * A brief warm centered pulse over the tavern when an intervention lands.
 * CSS handles the animation; this component just mounts/unmounts the node.
 */
export function LandingAnimation() {
  const { landingAnimationUntil } = useStore();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!landingAnimationUntil) return;
    const ms = landingAnimationUntil - Date.now();
    if (ms <= 0) return;
    setShow(true);
    const handle = setTimeout(() => setShow(false), ms);
    return () => clearTimeout(handle);
  }, [landingAnimationUntil]);

  if (!show) return null;
  return <div className="landing-pulse" data-testid="landing-pulse" aria-hidden />;
}
