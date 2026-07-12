import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/types";
import { db } from "../db/client";
import { env } from "../env";

interface CredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
}

function saveChallenge(userId: string, challenge: string) {
  db.prepare(
    `INSERT INTO webauthn_challenges (user_id, challenge) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET challenge = excluded.challenge, created_at = datetime('now')`
  ).run(userId, challenge);
}

function takeChallenge(userId: string): string | null {
  // A ceremony should complete within minutes of the options call — treat
  // anything older as expired rather than redeemable indefinitely.
  const row = db
    .prepare(
      `SELECT challenge FROM webauthn_challenges
       WHERE user_id = ? AND created_at > datetime('now', '-5 minutes')`
    )
    .get(userId) as { challenge: string } | undefined;
  db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").run(userId);
  return row?.challenge ?? null;
}

export async function getRegistrationOptions(userId: string, userName: string) {
  const existing = db
    .prepare("SELECT credential_id FROM webauthn_credentials WHERE user_id = ?")
    .all(userId) as { credential_id: string }[];

  const options = await generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpId,
    userName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  saveChallenge(userId, options.challenge);
  return options;
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON) {
  const expectedChallenge = takeChallenge(userId);
  if (!expectedChallenge) throw new Error("No pending registration challenge");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.origin,
    expectedRPID: env.rpId,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration could not be verified");
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  db.prepare(
    `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    credentialID,
    userId,
    credentialID,
    Buffer.from(credentialPublicKey).toString("base64url"),
    counter
  );

  return true;
}

export async function getAuthenticationOptions(userId: string) {
  const creds = db
    .prepare("SELECT credential_id FROM webauthn_credentials WHERE user_id = ?")
    .all(userId) as { credential_id: string }[];

  if (creds.length === 0) throw new Error("No passkeys registered for this user");

  const options = await generateAuthenticationOptions({
    rpID: env.rpId,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({ id: c.credential_id })),
  });

  saveChallenge(userId, options.challenge);
  return options;
}

export async function verifyAuthentication(userId: string, response: AuthenticationResponseJSON) {
  const expectedChallenge = takeChallenge(userId);
  if (!expectedChallenge) throw new Error("No pending authentication challenge");

  const credentialId = response.id;
  const cred = db
    .prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?")
    .get(credentialId, userId) as CredentialRow | undefined;

  if (!cred) throw new Error("Unknown passkey");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.origin,
    expectedRPID: env.rpId,
    authenticator: {
      credentialID: cred.credential_id,
      credentialPublicKey: Buffer.from(cred.public_key, "base64url"),
      counter: cred.counter,
    },
  });

  if (!verification.verified) throw new Error("Passkey authentication failed");

  db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(
    verification.authenticationInfo.newCounter,
    cred.id
  );

  return true;
}
