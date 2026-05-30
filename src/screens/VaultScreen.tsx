import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet} from 'react-native';
import {useIsFocused, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Box,
  HStack,
  Heading,
  Text,
  VStack,
} from '@gluestack-ui/themed';

import {NeonBackdrop, type NeonBackdropVariant} from '../../NeonBackdrop';
import {analysisToPasswordSequence, gestureApi} from '../../gestureApi';
import type {PasswordMovementType} from '../../gestureApi';
import {VaultHud} from '../game/VaultHud';
import {haptic} from '../game/haptics';
import {executeAction} from '../actions/executeAction';
import {formatSequence, matchSpell} from '../store/spell';
import {selectVaultStatus, useSessionStore} from '../store/sessionStore';
import {useSpellbookStore} from '../store/spellbookStore';
import type {VaultStatus} from '../store/selectors';
import {NeonButton, ButtonText} from '../ui';

const RESULT_HOLD_MS = 6000;

function backdropForStatus(status: VaultStatus): NeonBackdropVariant {
  if (status === 'unlocked') {
    return 'found';
  }
  if (status === 'denied') {
    return 'not-found';
  }
  if (status === 'analyzing' || status === 'processing' || status === 'recording') {
    return 'scanning';
  }
  return 'idle';
}

function liveHint(status: VaultStatus): string {
  switch (status) {
    case 'linked':
    case 'connected':
      return 'Double-tap your wearable to cast a spell';
    case 'recording':
      return 'Capturing motion from your wrist…';
    case 'processing':
      return 'Receiving recording…';
    case 'analyzing':
      return 'Matching your gesture against the spellbook…';
    case 'connecting':
      return 'Linking to your wearable…';
    case 'retry':
      return 'Connection dropped — reconnecting…';
    default:
      return 'Wearable offline — open Training to scan';
  }
}

export function VaultScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();

  const status = useSessionStore(selectVaultStatus);
  const recordingNonce = useSessionStore(s => s.recordingNonce);
  const lastRecording = useSessionStore(s => s.lastRecording);
  const vaultMessage = useSessionStore(s => s.vaultMessage);
  const vaultResult = useSessionStore(s => s.vaultResult);
  const matchedSpell = useSessionStore(s => s.vaultMatchedSpell);
  const setVaultAnalyzing = useSessionStore(s => s.setVaultAnalyzing);
  const setVaultResult = useSessionStore(s => s.setVaultResult);
  const clearVaultResult = useSessionStore(s => s.clearVaultResult);

  const spells = useSpellbookStore(s => s.spells);
  const enabledCount = useMemo(() => spells.filter(s => s.enabled).length, [spells]);

  const [lastDetected, setLastDetected] = useState<PasswordMovementType[]>([]);
  const handledNonceRef = useRef(0);

  // The Vault auto-casts: whenever a NEW recording arrives while this tab is
  // focused, analyze it, match against the spellbook, and fire the action.
  useEffect(() => {
    if (!isFocused) {
      return;
    }
    if (recordingNonce === 0 || recordingNonce === handledNonceRef.current) {
      return;
    }
    const recording = lastRecording;
    if (recording == null || recording.samples.length < 10) {
      return;
    }
    handledNonceRef.current = recordingNonce;

    let cancelled = false;
    (async () => {
      clearVaultResult();
      setVaultAnalyzing(true);
      haptic('select');
      try {
        const response = await gestureApi.analyzeRecording({
          window_id: recording.windowId,
          samples: recording.samples,
          include_still: true,
          min_confidence: 0.5,
        });
        if (cancelled) {
          return;
        }
        const detected = analysisToPasswordSequence(response);
        setLastDetected(detected);
        const spell = matchSpell(spells, detected);
        if (spell != null) {
          const result = await executeAction(spell.action);
          if (cancelled) {
            return;
          }
          haptic(result.ok ? 'success' : 'error');
          setVaultResult('unlocked', {
            message: `${spell.name} · ${result.message}`,
            matchedSpell: spell.name,
          });
        } else {
          haptic('error');
          setVaultResult('denied', {
            message:
              detected.length > 0
                ? `Cast ${formatSequence(detected)} — no spell bound`
                : 'No gesture detected',
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        haptic('error');
        setVaultResult('denied', {
          message: error instanceof Error ? error.message : 'Analysis failed',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    recordingNonce,
    isFocused,
    lastRecording,
    spells,
    clearVaultResult,
    setVaultAnalyzing,
    setVaultResult,
  ]);

  // Auto-return to the live status after holding the result for a moment.
  useEffect(() => {
    if (vaultResult == null) {
      return;
    }
    const timer = setTimeout(() => clearVaultResult(), RESULT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [vaultResult, clearVaultResult]);

  const message = vaultResult != null ? vaultMessage : liveHint(status);

  return (
    <Box flex={1} bg="#020617">
      <NeonBackdrop
        variant={backdropForStatus(status)}
        active={isFocused}
        targetFps={24}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {paddingTop: insets.top + 24, paddingBottom: insets.bottom + 48},
        ]}>
        <VStack px="$5" space="lg" alignItems="center">
          <VStack alignItems="center" space="xs">
            <Text
              color="#22d3ee"
              fontSize="$xs"
              fontWeight="$extrabold"
              letterSpacing="$2xl"
              textTransform="uppercase">
              Abracadabra
            </Text>
            <Heading
              color="$coolGray50"
              size="2xl"
              fontWeight="$black"
              letterSpacing="$xl"
              textTransform="uppercase">
              The Vault
            </Heading>
          </VStack>

          <Box mt="$4">
            <VaultHud status={status} message={message} active={isFocused} />
          </Box>

          {matchedSpell != null && vaultResult === 'unlocked' ? (
            <Box
              px="$5"
              py="$3"
              borderRadius="$2xl"
              borderWidth={1}
              borderColor="rgba(34,197,94,0.55)"
              bg="rgba(6,78,59,0.35)">
              <Text
                color="#86efac"
                fontWeight="$extrabold"
                letterSpacing="$lg"
                textTransform="uppercase"
                textAlign="center">
                {matchedSpell}
              </Text>
            </Box>
          ) : null}

          <Box
            mt="$2"
            w="100%"
            p="$4"
            borderRadius="$2xl"
            borderWidth={1}
            borderColor="rgba(148,163,184,0.22)"
            bg="rgba(15,23,42,0.66)">
            <HStack justifyContent="space-between" alignItems="center">
              <Text
                color="#67e8f9"
                fontSize="$xs"
                fontWeight="$extrabold"
                letterSpacing="$lg"
                textTransform="uppercase">
                Last cast
              </Text>
              <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                {enabledCount} spell{enabledCount === 1 ? '' : 's'} armed
              </Text>
            </HStack>
            <Text mt="$2" color="#e0f2fe" fontFamily="Menlo" fontSize="$sm">
              {lastDetected.length > 0
                ? formatSequence(lastDetected)
                : 'Cast a gesture to see it here'}
            </Text>
            <NeonButton
              mt="$4"
              size="sm"
              borderRadius="$xl"
              bg="#00f5ff"
              isDisabled={lastDetected.length === 0}
              opacity={lastDetected.length === 0 ? 0.55 : 1}
              onPress={() =>
                navigation.navigate('Spellbook', {prefillSequence: lastDetected})
              }>
              <ButtonText
                color="#020617"
                fontWeight="$extrabold"
                letterSpacing="$md"
                fontSize="$xs"
                textTransform="uppercase">
                Bind this gesture to a spell
              </ButtonText>
            </NeonButton>
          </Box>
        </VStack>
      </ScrollView>
    </Box>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
  },
});
