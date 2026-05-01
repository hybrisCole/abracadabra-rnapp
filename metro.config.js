const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      // @gluestack-ui/themed → react-aria expects `react-dom` (flushSync); RN has no react-dom.
      'react-dom': path.resolve(__dirname, 'rn-shims/react-dom'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
