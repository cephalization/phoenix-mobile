import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useDuoPreviewStore } from '@/features/duo/preview-store';

/**
 * `phoenixmobile://duo-preview?enabled=1&display=inner&orientation=portrait&pose=book&angle=120`
 * configures the iPhone Duo preview harness from a link, which lets a simulator
 * or a demo script jump straight into a pose, then returns to the instance list.
 */
export default function DuoPreviewLink() {
  const params = useLocalSearchParams<{
    angle?: string;
    display?: string;
    enabled?: string;
    orientation?: string;
    pose?: string;
  }>();

  const setEnabled = useDuoPreviewStore((state) => state.setEnabled);
  const setDisplay = useDuoPreviewStore((state) => state.setDisplay);
  const setOrientation = useDuoPreviewStore((state) => state.setOrientation);
  const setPose = useDuoPreviewStore((state) => state.setPose);
  const setHingeAngle = useDuoPreviewStore((state) => state.setHingeAngle);
  const { angle, display, enabled, orientation, pose } = params;

  useEffect(() => {
    if (enabled !== undefined) setEnabled(enabled !== '0');

    if (display === 'inner' || display === 'outer') setDisplay(display);

    if (orientation === 'portrait' || orientation === 'landscape') setOrientation(orientation);

    if (pose === 'flat' || pose === 'book' || pose === 'tabletop') setPose(pose);

    const degrees = Number(angle);

    if (angle !== undefined && Number.isFinite(degrees)) setHingeAngle(degrees);
  }, [
    angle,
    display,
    enabled,
    orientation,
    pose,
    setDisplay,
    setEnabled,
    setHingeAngle,
    setOrientation,
    setPose,
  ]);

  return <Redirect href="/" />;
}
