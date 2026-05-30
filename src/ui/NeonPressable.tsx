import React, {type ReactNode} from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import {haptic} from '../game/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SPRING_PRESS = {damping: 18, stiffness: 420, mass: 0.35};
const SPRING_RELEASE = {damping: 16, stiffness: 360, mass: 0.35};

type NeonPressableProps = PressableProps & {
  children: ReactNode;
  /** When false, skip scale animation (e.g. disabled-looking tabs). */
  pressFeedback?: boolean;
};

/**
 * Pressable with a quick scale-down + spring release and light haptic tap.
 */
export function NeonPressable({
  children,
  style,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  pressFeedback = true,
  ...rest
}: NeonPressableProps): React.JSX.Element {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style as StyleProp<ViewStyle>, pressFeedback ? animatedStyle : undefined]}
      onPressIn={event => {
        if (pressFeedback && !disabled) {
          scale.value = withSpring(0.96, SPRING_PRESS);
        }
        onPressIn?.(event);
      }}
      onPressOut={event => {
        if (pressFeedback) {
          scale.value = withSpring(1, SPRING_RELEASE);
        }
        onPressOut?.(event);
      }}
      onPress={event => {
        if (!disabled) {
          haptic('select');
        }
        onPress?.(event);
      }}>
      {children}
    </AnimatedPressable>
  );
}
