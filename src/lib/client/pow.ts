"use client";

export interface PowChallengeDto {
  token: string;
  prefix: string;
  difficultyBits: number;
}

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/**
 * Solves the proof-of-work challenge issued by the server (SHA-256 with leading zero bits).
 * It yields to the UI every few thousand attempts so the screen stays responsive.
 */
export async function solveChallenge(challenge: PowChallengeDto): Promise<{ token: string; nonce: string }> {
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < 100_000_000; nonce += 1) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.prefix}:${nonce}`)));
    if (leadingZeroBits(digest) >= challenge.difficultyBits) {
      return { token: challenge.token, nonce: String(nonce) };
    }
    if (nonce % 2000 === 1999) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error("challenge not solved");
}
