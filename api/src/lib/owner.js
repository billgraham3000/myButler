// MyButler has one user, its owner. OWNER_EMAIL is the only address that can sign in; OWNER_ID names the owner's
// data folder (kept from MyButler's time in 4Muses, so the data moved without renaming).
export const owner = () => ({ id: process.env.OWNER_ID || 'owner', email: String(process.env.OWNER_EMAIL || '').trim().toLowerCase() });
export const isOwnerEmail = (email) => !!owner().email && String(email || '').trim().toLowerCase() === owner().email;
