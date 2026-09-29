// The signed-in landlord ({ landlordId, name }), kept in localStorage like the chat's threadId, so a
// reload stays signed in. Storage may be missing or throw (private mode, blocked site data): the
// landlord then stays signed in only as long as the page.

export const LANDLORD_KEY = "amt-buddy.landlord";

// The stored landlord, or null when there is none (or the stored value is unusable).
export function storedLandlord(storage) {
  try {
    const landlord = JSON.parse(storage?.getItem(LANDLORD_KEY) ?? "null");
    const usable =
      typeof landlord?.landlordId === "string" && landlord.landlordId && typeof landlord.name === "string";
    return usable ? { landlordId: landlord.landlordId, name: landlord.name } : null;
  } catch {
    return null;
  }
}

export function rememberLandlord(storage, { landlordId, name }) {
  try {
    storage?.setItem(LANDLORD_KEY, JSON.stringify({ landlordId, name }));
  } catch {
    // Not persisted; the landlord stays signed in until the page is left.
  }
}

export function forgetLandlord(storage) {
  try {
    storage?.removeItem(LANDLORD_KEY);
  } catch {
    // Nothing stored that could be removed.
  }
}
