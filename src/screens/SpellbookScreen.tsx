import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Box,
  Button,
  ButtonText,
  HStack,
  Heading,
  Input,
  InputField,
  Pressable,
  Text,
  VStack,
} from '@gluestack-ui/themed';

import type {PasswordMovementType} from '../../gestureApi';
import {describeAction, formatSequence, type UnlockAction} from '../store/spell';
import {useSpellbookStore} from '../store/spellbookStore';

type ActionType = UnlockAction['type'];

const ACTION_TYPES: {value: ActionType; label: string}[] = [
  {value: 'open_url', label: 'Open URL'},
  {value: 'sms', label: 'SMS'},
  {value: 'http', label: 'Webhook'},
  {value: 'notify', label: 'Notify'},
];

const PRIMARY_PLACEHOLDER: Record<ActionType, string> = {
  open_url: 'https://youtube.com/…',
  sms: '+15551234567',
  http: 'https://homeassistant.local/api/…',
  notify: 'Spell title',
};

function buildAction(
  type: ActionType,
  primary: string,
  secondary: string,
  method: 'GET' | 'POST',
): UnlockAction {
  switch (type) {
    case 'open_url':
      return {type, url: primary.trim()};
    case 'sms':
      return {
        type,
        phone: primary.trim(),
        body: secondary.trim() || undefined,
      };
    case 'http':
      return {type, method, url: primary.trim()};
    case 'notify':
      return {type, title: primary.trim(), body: secondary.trim() || undefined};
  }
}

export function SpellbookScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const prefill: PasswordMovementType[] = useMemo(
    () => route.params?.prefillSequence ?? [],
    [route.params?.prefillSequence],
  );

  const spells = useSpellbookStore(s => s.spells);
  const addSpell = useSpellbookStore(s => s.addSpell);
  const removeSpell = useSpellbookStore(s => s.removeSpell);
  const toggleSpell = useSpellbookStore(s => s.toggleSpell);

  const [name, setName] = useState('');
  const [actionType, setActionType] = useState<ActionType>('open_url');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('POST');
  const [sequence, setSequence] = useState<PasswordMovementType[]>(prefill);

  useEffect(() => {
    if (prefill.length > 0) {
      setSequence(prefill);
    }
  }, [prefill]);

  const canSave =
    name.trim().length > 0 && primary.trim().length > 0 && sequence.length > 0;

  const onSave = () => {
    if (!canSave) {
      return;
    }
    addSpell({
      name: name.trim(),
      sequence,
      action: buildAction(actionType, primary, secondary, method),
    });
    setName('');
    setPrimary('');
    setSecondary('');
  };

  return (
    <Box flex={1} bg="#020617">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {paddingTop: insets.top + 24, paddingBottom: insets.bottom + 48},
        ]}>
        <VStack px="$5" space="lg">
          <VStack space="xs">
            <Text
              color="#d946ef"
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
              Spellbook
            </Heading>
            <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
              Bind a gesture combination to an action the phone performs on a
              match.
            </Text>
          </VStack>

          <Box
            p="$4"
            borderRadius="$2xl"
            borderWidth={1}
            borderColor="rgba(34,211,238,0.28)"
            bg="rgba(15,23,42,0.66)">
            <Text
              color="#67e8f9"
              fontSize="$xs"
              fontWeight="$extrabold"
              letterSpacing="$lg"
              textTransform="uppercase">
              New spell
            </Text>

            <Box mt="$3">
              <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs" mb="$1">
                Gesture: {sequence.length > 0 ? formatSequence(sequence) : 'cast a gesture in The Vault first'}
              </Text>
            </Box>

            <Input
              mt="$3"
              borderRadius="$xl"
              borderColor="rgba(148,163,184,0.35)"
              bg="rgba(2,6,23,0.6)">
              <InputField
                color="#e0f2fe"
                placeholder="Spell name"
                placeholderTextColor="#475569"
                value={name}
                onChangeText={setName}
              />
            </Input>

            <HStack mt="$3" space="sm" flexWrap="wrap">
              {ACTION_TYPES.map(option => {
                const active = option.value === actionType;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setActionType(option.value)}>
                    <Box
                      px="$3"
                      py="$2"
                      borderRadius="$lg"
                      borderWidth={1}
                      borderColor={active ? '#22d3ee' : 'rgba(148,163,184,0.3)'}
                      bg={active ? 'rgba(8,47,73,0.6)' : 'rgba(2,6,23,0.5)'}>
                      <Text
                        color={active ? '#67e8f9' : '#94a3b8'}
                        fontSize="$xs"
                        fontWeight="$bold"
                        textTransform="uppercase">
                        {option.label}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>

            {actionType === 'http' ? (
              <HStack mt="$3" space="sm">
                {(['GET', 'POST'] as const).map(m => {
                  const active = m === method;
                  return (
                    <Pressable key={m} onPress={() => setMethod(m)}>
                      <Box
                        px="$3"
                        py="$2"
                        borderRadius="$lg"
                        borderWidth={1}
                        borderColor={active ? '#d946ef' : 'rgba(148,163,184,0.3)'}
                        bg={active ? 'rgba(88,28,135,0.4)' : 'rgba(2,6,23,0.5)'}>
                        <Text
                          color={active ? '#f0abfc' : '#94a3b8'}
                          fontSize="$xs"
                          fontWeight="$bold">
                          {m}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })}
              </HStack>
            ) : null}

            <Input
              mt="$3"
              borderRadius="$xl"
              borderColor="rgba(148,163,184,0.35)"
              bg="rgba(2,6,23,0.6)">
              <InputField
                color="#e0f2fe"
                placeholder={PRIMARY_PLACEHOLDER[actionType]}
                placeholderTextColor="#475569"
                autoCapitalize="none"
                value={primary}
                onChangeText={setPrimary}
              />
            </Input>

            {actionType === 'sms' || actionType === 'notify' ? (
              <Input
                mt="$3"
                borderRadius="$xl"
                borderColor="rgba(148,163,184,0.35)"
                bg="rgba(2,6,23,0.6)">
                <InputField
                  color="#e0f2fe"
                  placeholder={actionType === 'sms' ? 'Message body (optional)' : 'Body (optional)'}
                  placeholderTextColor="#475569"
                  value={secondary}
                  onChangeText={setSecondary}
                />
              </Input>
            ) : null}

            <Button
              mt="$4"
              borderRadius="$xl"
              bg="#00f5ff"
              isDisabled={!canSave}
              opacity={canSave ? 1 : 0.5}
              onPress={onSave}>
              <ButtonText
                color="#020617"
                fontWeight="$extrabold"
                letterSpacing="$md"
                fontSize="$sm"
                textTransform="uppercase">
                Save spell
              </ButtonText>
            </Button>
          </Box>

          <VStack space="md">
            <Text
              color="#94a3b8"
              fontSize="$xs"
              fontWeight="$extrabold"
              letterSpacing="$lg"
              textTransform="uppercase">
              {spells.length} bound spell{spells.length === 1 ? '' : 's'}
            </Text>

            {spells.length === 0 ? (
              <Text color="#64748b" fontFamily="Menlo" fontSize="$sm">
                No spells yet. Cast a gesture in The Vault, then bind it here.
              </Text>
            ) : null}

            {spells.map(spell => (
              <Box
                key={spell.id}
                p="$4"
                borderRadius="$2xl"
                borderWidth={1}
                borderColor={
                  spell.enabled
                    ? 'rgba(34,197,94,0.4)'
                    : 'rgba(148,163,184,0.22)'
                }
                bg="rgba(15,23,42,0.6)">
                <HStack justifyContent="space-between" alignItems="center">
                  <Text color="$coolGray50" fontWeight="$bold" fontSize="$md">
                    {spell.name}
                  </Text>
                  <Pressable onPress={() => toggleSpell(spell.id)}>
                    <Box
                      px="$2"
                      py="$1"
                      borderRadius="$md"
                      bg={spell.enabled ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.25)'}>
                      <Text
                        color={spell.enabled ? '#86efac' : '#94a3b8'}
                        fontSize="$xs"
                        fontWeight="$bold"
                        textTransform="uppercase">
                        {spell.enabled ? 'Armed' : 'Off'}
                      </Text>
                    </Box>
                  </Pressable>
                </HStack>
                <Text mt="$2" color="#e0f2fe" fontFamily="Menlo" fontSize="$xs">
                  {formatSequence(spell.sequence)}
                </Text>
                <Text mt="$1" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                  {describeAction(spell.action)}
                </Text>
                <Button
                  mt="$3"
                  size="sm"
                  variant="outline"
                  alignSelf="flex-start"
                  borderRadius="$lg"
                  borderColor="rgba(251,113,133,0.5)"
                  bg="rgba(15,23,42,0.7)"
                  onPress={() => removeSpell(spell.id)}>
                  <ButtonText
                    color="#fda4af"
                    fontWeight="$bold"
                    fontSize="$xs"
                    textTransform="uppercase">
                    Delete
                  </ButtonText>
                </Button>
              </Box>
            ))}
          </VStack>
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
