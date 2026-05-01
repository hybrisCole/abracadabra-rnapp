import React, {useCallback, useEffect, useRef} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import {
  Badge,
  Box,
  HStack,
  Pressable,
  Text,
  useToast,
  VStack,
} from '@gluestack-ui/themed';

export type LinkBadgeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'linked'
  | 'recording'
  | 'processing'
  | 'retry';

const LABELS: Record<LinkBadgeStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  linked: 'Linked',
  recording: 'Recording',
  processing: 'Processing',
  retry: 'Retry',
};

const ORB_THEME: Record<
  LinkBadgeStatus,
  {ring: string; core: string; glow: string}
> = {
  disconnected: {ring: '#64748b', core: '#94a3b8', glow: '#334155'},
  connecting: {ring: '#22d3ee', core: '#67e8f9', glow: '#0891b2'},
  retry: {ring: '#fbbf24', core: '#fde047', glow: '#ca8a04'},
  connected: {ring: '#34d399', core: '#6ee7b7', glow: '#059669'},
  linked: {ring: '#5eead4', core: '#99f6e4', glow: '#14b8a6'},
  recording: {ring: '#e879f9', core: '#f0abfc', glow: '#a21caf'},
  processing: {ring: '#38bdf8', core: '#7dd3fc', glow: '#0284c7'},
};

function badgeActionForStatus(
  s: LinkBadgeStatus,
): 'error' | 'warning' | 'success' | 'info' | 'muted' {
  switch (s) {
    case 'disconnected':
      return 'error';
    case 'retry':
      return 'warning';
    case 'recording':
    case 'processing':
    case 'connecting':
      return 'info';
    default:
      return 'success';
  }
}

/** Single-slot toast id so reopening replaces instead of stacking. */
const LINK_DETAIL_TOAST_ID = 'abracadabra-link-detail';

export function BleLinkStatusBadge({
  status,
  pulse,
  detailTitle,
  detailDescription,
}: {
  status: LinkBadgeStatus;
  pulse: Animated.Value;
  detailTitle: string;
  detailDescription: string;
}): React.JSX.Element {
  const toast = useToast();
  const detailToastIdRef = useRef<string | null>(null);
  const labelOpacity = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(1)).current;
  const prevStatus = useRef(status);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      labelOpacity.setValue(0.35);
      Animated.timing(labelOpacity, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      orbOpacity.setValue(0.45);
      Animated.timing(orbOpacity, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [status, labelOpacity, orbOpacity]);

  const theme = ORB_THEME[status];
  const orbScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.06],
  });

  const toggleDetailToast = useCallback(() => {
    const openId = detailToastIdRef.current;
    if (openId != null) {
      if (toast.isActive(openId)) {
        toast.close(openId);
        detailToastIdRef.current = null;
        return;
      }
      detailToastIdRef.current = null;
    }

    const screenW = Dimensions.get('window').width;
    const cardWidth = Math.min(screenW - 32, 400);

    const id = toast.show({
      id: LINK_DETAIL_TOAST_ID,
      placement: 'top',
      duration: 1000,
      onCloseComplete: () => {
        detailToastIdRef.current = null;
      },
      render: ({id: toastId}) => (
        <View
          nativeID={toastId}
          accessibilityRole="alert"
          style={[styles.toastCardOuter, {width: cardWidth}]}>
          <VStack space="sm" alignSelf="stretch">
            <Text
              fontSize="$xs"
              fontWeight="$extrabold"
              letterSpacing="$xl"
              color="#67e8f9"
              textTransform="uppercase">
              {detailTitle}
            </Text>
            <Text
              fontSize="$sm"
              color="#cbd5e1"
              lineHeight={22}
              flexShrink={1}>
              {detailDescription}
            </Text>
          </VStack>
        </View>
      ),
    });
    detailToastIdRef.current = id;
  }, [detailDescription, detailTitle, toast]);

  const action = badgeActionForStatus(status);

  return (
    <Badge
      variant="outline"
      action={action}
      alignSelf="stretch"
      flexDirection="row"
      borderRadius="$full"
      px="$3"
      py="$2"
      bg="rgba(2,6,23,0.92)"
      borderColor={
        status === 'disconnected'
          ? 'rgba(248,113,113,0.5)'
          : status === 'retry'
            ? 'rgba(251,191,36,0.55)'
            : 'rgba(34,211,238,0.42)'
      }>
      <HStack alignItems="center" flex={1} space="sm">
        <Pressable
          onPress={toggleDetailToast}
          accessibilityRole="button"
          accessibilityLabel="Show or hide link details"
          width="30%"
          maxWidth="30%"
          alignItems="center"
          justifyContent="center"
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <Animated.View
            style={[
              styles.orbAnimWrap,
              {
                opacity: orbOpacity,
                transform: [{scale: orbScale}],
              },
            ]}>
            <Box
              position="absolute"
              w={38}
              h={38}
              borderRadius="$full"
              opacity={0.4}
              bg={theme.glow}
            />
            <Box
              w={32}
              h={32}
              borderRadius="$full"
              borderWidth={2}
              borderColor={theme.ring}
              bg="rgba(15,23,42,0.9)"
              alignItems="center"
              justifyContent="center">
              <Box w={10} h={10} borderRadius="$full" bg={theme.core} />
            </Box>
          </Animated.View>
        </Pressable>
        <Box
          flex={1}
          justifyContent="center"
          alignItems="center"
          minWidth={0}
          pr="$1">
          <Animated.View
            style={[styles.labelFadeStretch, {opacity: labelOpacity}]}>
            <Text
              color="$coolGray50"
              fontWeight="$extrabold"
              fontSize="$sm"
              letterSpacing="$lg"
              textTransform="uppercase"
              textAlign="center"
              numberOfLines={2}>
              {LABELS[status]}
            </Text>
          </Animated.View>
        </Box>
      </HStack>
    </Badge>
  );
}

const styles = StyleSheet.create({
  orbAnimWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    width: 44,
  },
  toastCardOuter: {
    alignSelf: 'center',
    maxWidth: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(34,211,238,0.55)',
    backgroundColor: 'rgba(15,23,42,0.98)',
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#00f5ff',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 12,
  },
  labelFadeStretch: {
    alignSelf: 'stretch',
  },
});
