module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    '@babel/plugin-transform-class-static-block',
    // Must stay LAST: Reanimated v4 + Gesture Handler rely on the Worklets
    // Babel plugin to compile worklet functions.
    'react-native-worklets/plugin',
  ],
};
