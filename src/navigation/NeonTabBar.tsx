import React from 'react';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Box, HStack, Text, VStack} from '@gluestack-ui/themed';
import {NeonPressable} from '../ui/NeonPressable';

const ACCENT: Record<string, string> = {
  Vault: '#22d3ee',
  Training: '#d946ef',
  Spellbook: '#34d399',
};

/**
 * Cyberpunk bottom tab bar: neon labels with a glowing active indicator bar.
 * Header is hidden; this is the only chrome on the game shell.
 */
export function NeonTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <Box
      borderTopWidth={1}
      borderColor="rgba(34,211,238,0.18)"
      bg="rgba(2,6,23,0.96)"
      pt="$2"
      pb={insets.bottom > 0 ? insets.bottom : 12}
      px="$3">
      <HStack justifyContent="space-around" alignItems="center">
        {state.routes.map((route, index) => {
          const {options} = descriptors[route.key];
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;
          const isFocused = state.index === index;
          const accent = ACCENT[route.name] ?? '#22d3ee';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <NeonPressable
              key={route.key}
              style={{flex: 1}}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? {selected: true} : {}}>
              <VStack alignItems="center" space="xs" py="$1">
                <Box
                  h={3}
                  w={isFocused ? 28 : 0}
                  borderRadius="$full"
                  bg={accent}
                  opacity={isFocused ? 1 : 0}
                />
                <Text
                  color={isFocused ? accent : '#64748b'}
                  fontSize="$xs"
                  fontWeight="$extrabold"
                  letterSpacing="$lg"
                  textTransform="uppercase">
                  {label}
                </Text>
              </VStack>
            </NeonPressable>
          );
        })}
      </HStack>
    </Box>
  );
}
