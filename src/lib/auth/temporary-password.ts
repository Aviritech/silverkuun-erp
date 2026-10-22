import { randomInt } from "node:crypto";

// No 0/O, 1/l/I: the password is read out or typed from a message.
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

/** A one-time password like "Kp7w-Rt3m-Hx9q", handed to a new or locked-out staff member, who must change it. */
export function temporaryPassword(): string {
  const group = () => {
    const chars = Array.from({ length: 3 }, () => LETTERS[randomInt(LETTERS.length)]);
    chars.splice(randomInt(4), 0, DIGITS[randomInt(DIGITS.length)]);
    return chars.join("");
  };
  return [group(), group(), group()].join("-");
}
