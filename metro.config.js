const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isNative = platform === 'android' || platform === 'ios';
  const isUnusedNodeConfigModule = moduleName === 'node:fs' || moduleName === 'node:path';

  // phoenix-config imports env-file helpers eagerly, but the app always supplies
  // explicit client options and never accesses those Node-only helpers.
  if (isNative && isUnusedNodeConfigModule) {
    return { type: 'empty' };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
