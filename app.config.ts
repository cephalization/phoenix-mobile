import type { ConfigContext } from 'expo/config';

/**
 * Everything shared lives in `app.json`. Apple signing belongs to whoever is
 * building, and a bundle identifier can only be registered to one team, so
 * those two come from the environment (`.env.local`, see `.env.example`).
 * Expo Go and simulators need neither.
 */
export default function appConfig({ config }: ConfigContext) {
  return {
    ...config,
    ios: {
      ...config.ios,
      appleTeamId: process.env.PHOENIX_APPLE_TEAM_ID || undefined,
      bundleIdentifier: process.env.PHOENIX_IOS_BUNDLE_ID || config.ios?.bundleIdentifier,
    },
  };
}
