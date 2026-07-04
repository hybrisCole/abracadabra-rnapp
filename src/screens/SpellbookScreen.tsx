import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, ScrollView, StyleSheet} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Box,
  HStack,
  Heading,
  Input,
  InputField,
  Text,
  VStack,
} from '@gluestack-ui/themed';

import type {PasswordMovementType} from '../../gestureApi';
import {pickPhoneContact, type PickedPhoneContact} from '../actions/pickPhoneContact';
import {describeAction, formatSequence, type UnlockAction} from '../store/spell';
import {useSpellbookStore} from '../store/spellbookStore';
import {NeonButton, ButtonText, NeonPressable} from '../ui';

type ActionType = UnlockAction['type'];

const ACTION_TYPES: {value: ActionType; label: string}[] = [
  {value: 'open_url', label: 'Open URL'},
  {value: 'sms', label: 'SMS'},
  {value: 'http', label: 'Webhook'},
  {value: 'call', label: 'Call'},
];

const PRIMARY_PLACEHOLDER: Record<Exclude<ActionType, 'call'>, string> = {
  open_url: 'https://youtube.com/…',
  sms: '+15551234567',
  http: 'https://homeassistant.local/api/…',
};

function buildAction(
  type: ActionType,
  primary: string,
  secondary: string,
  method: 'GET' | 'POST',
  callContact: PickedPhoneContact | null,
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
    case 'call':
      if (callContact == null || callContact.phone.trim().length === 0) {
        throw new Error('Call spell requires a contact with a phone number');
      }
      return {
        type,
        phone: callContact.phone,
        contactName: callContact.name || undefined,
      };
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
  const [callContact, setCallContact] = useState<PickedPhoneContact | null>(null);
  const [pickingContact, setPickingContact] = useState(false);
  const [sequence, setSequence] = useState<PasswordMovementType[]>(prefill);

  useEffect(() => {
    if (prefill.length > 0) {
      setSequence(prefill);
    }
  }, [prefill]);

  const canSave =
    name.trim().length > 0 &&
    sequence.length > 0 &&
    (actionType === 'call'
      ? (callContact?.phone.trim().length ?? 0) > 0
      : primary.trim().length > 0);

  const onPickContact = useCallback(async () => {
    if (pickingContact) {
      return;
    }
    setPickingContact(true);
    try {
      const contact = await pickPhoneContact();
      if (contact != null) {
        setCallContact(contact);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not open contacts';
      Alert.alert('Choose contact', message);
    } finally {
      setPickingContact(false);
    }
  }, [pickingContact]);

  const onSave = () => {
    if (!canSave) {
      return;
    }
    addSpell({
      name: name.trim(),
      sequence,
      action: buildAction(actionType, primary, secondary, method, callContact),
    });
    setName('');
    setPrimary('');
    setSecondary('');
    setCallContact(null);
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
                  <NeonPressable
                    key={option.value}
                    onPress={() => {
                      setActionType(option.value);
                      if (option.value !== 'call') {
                        setCallContact(null);
                      }
                    }}>
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
                  </NeonPressable>
                );
              })}
            </HStack>

            {actionType === 'http' ? (
              <HStack mt="$3" space="sm">
                {(['GET', 'POST'] as const).map(m => {
                  const active = m === method;
                  return (
                    <NeonPressable key={m} onPress={() => setMethod(m)}>
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
                    </NeonPressable>
                  );
                })}
              </HStack>
            ) : null}

            {actionType === 'call' ? (
              <VStack mt="$3" space="sm">
                {callContact != null ? (
                  <Box
                    p="$3"
                    borderRadius="$xl"
                    borderWidth={1}
                    borderColor="rgba(34,211,238,0.35)"
                    bg="rgba(2,6,23,0.55)">
                    <Text color="#e0f2fe" fontWeight="$bold" fontSize="$sm">
                      {callContact.name || 'Contact'}
                    </Text>
                    <Text
                      mt="$1"
                      color="#94a3b8"
                      fontFamily="Menlo"
                      fontSize="$xs">
                      {callContact.phone}
                    </Text>
                  </Box>
                ) : (
                  <Text color="#64748b" fontFamily="Menlo" fontSize="$xs">
                    Pick someone from your address book to dial when this spell
                    fires.
                  </Text>
                )}
                <NeonButton
                  borderRadius="$xl"
                  bg="rgba(8,47,73,0.85)"
                  borderWidth={1}
                  borderColor="rgba(34,211,238,0.45)"
                  isDisabled={pickingContact}
                  opacity={pickingContact ? 0.6 : 1}
                  onPress={() => {
                    void onPickContact();
                  }}>
                  <ButtonText
                    color="#67e8f9"
                    fontWeight="$extrabold"
                    letterSpacing="$md"
                    fontSize="$sm"
                    textTransform="uppercase">
                    {pickingContact
                      ? 'Opening contacts…'
                      : callContact != null
                        ? 'Change contact'
                        : 'Choose contact'}
                  </ButtonText>
                </NeonButton>
              </VStack>
            ) : (
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
            )}

            {actionType === 'sms' ? (
              <Input
                mt="$3"
                borderRadius="$xl"
                borderColor="rgba(148,163,184,0.35)"
                bg="rgba(2,6,23,0.6)">
                <InputField
                  color="#e0f2fe"
                  placeholder="Message body (optional)"
                  placeholderTextColor="#475569"
                  value={secondary}
                  onChangeText={setSecondary}
                />
              </Input>
            ) : null}

            <NeonButton
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
            </NeonButton>
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
                  <NeonPressable onPress={() => toggleSpell(spell.id)}>
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
                  </NeonPressable>
                </HStack>
                <Text mt="$2" color="#e0f2fe" fontFamily="Menlo" fontSize="$xs">
                  {formatSequence(spell.sequence)}
                </Text>
                <Text mt="$1" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                  {describeAction(spell.action)}
                </Text>
                <NeonButton
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
                </NeonButton>
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
