import React from 'react';
import {type ViewStyle} from 'react-native';
import {Button as GlueButton, ButtonText} from '@gluestack-ui/themed';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import {haptic} from '../game/haptics';

export {ButtonText};

const SPRING_PRESS = {damping: 18, stiffness: 420, mass: 0.35};
const SPRING_RELEASE = {damping: 16, stiffness: 360, mass: 0.35};

type NeonButtonProps = React.ComponentProps<typeof GlueButton>;

/**
 * Gluestack Button with scale + opacity press feedback and a light haptic.
 * Drop-in replacement for `Button` across the cyberpunk UI.
 */
export function NeonButton({
  children,
  onPress,
  onPressIn,
  onPressOut,
  isDisabled,
  style,
  flex,
  flexGrow,
  flexShrink,
  alignSelf,
  ...rest
}: NeonButtonProps): React.JSX.Element {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
    opacity: opacity.value,
  }));

  const shellStyle: ViewStyle = {};
  if (flex != null) {
    shellStyle.flex = flex;
  }
  if (flexGrow != null) {
    shellStyle.flexGrow = flexGrow;
  }
  if (flexShrink != null) {
    shellStyle.flexShrink = flexShrink;
  }
  if (alignSelf != null) {
    shellStyle.alignSelf = alignSelf;
  }

  return (
    <Animated.View style={[shellStyle, animatedStyle]}>
      <GlueButton
        {...rest}
        flex={flex}
        flexGrow={flexGrow}
        flexShrink={flexShrink}
        alignSelf={alignSelf}
        style={style}
        isDisabled={isDisabled}
        onPressIn={event => {
          if (!isDisabled) {
            scale.value = withSpring(0.96, SPRING_PRESS);
            opacity.value = withSpring(0.88, SPRING_PRESS);
          }
          onPressIn?.(event);
        }}
        onPressOut={event => {
          scale.value = withSpring(1, SPRING_RELEASE);
          opacity.value = withSpring(1, SPRING_RELEASE);
          onPressOut?.(event);
        }}
        onPress={event => {
          if (!isDisabled) {
            haptic('select');
          }
          onPress?.(event);
        }}>
        {children}
      </GlueButton>
    </Animated.View>
  );
}
