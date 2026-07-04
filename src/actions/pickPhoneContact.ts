import {pickContact} from 'react-native-pick-contact';

export type PickedPhoneContact = {
  name: string;
  phone: string;
};

/** Opens the system contact picker (no READ_CONTACTS on iOS). */
export async function pickPhoneContact(): Promise<PickedPhoneContact | null> {
  const contact = await pickContact();
  if (contact == null || contact.phone.trim().length === 0) {
    return null;
  }
  return {name: contact.name.trim(), phone: contact.phone.trim()};
}
