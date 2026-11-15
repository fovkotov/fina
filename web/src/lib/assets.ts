const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const AVATARS: Record<string, string> = {
  Аня: `${BASE_PATH}/assets/avatar-anya.png`,
  Андрей: `${BASE_PATH}/assets/avatar-andrey.png`,
};

export const PLUS_STICKER = `${BASE_PATH}/assets/sign-plus.webm`;

export const SIGN_IMAGES = {
  deposit: `${BASE_PATH}/assets/sign-plus.png`,
  withdrawal: `${BASE_PATH}/assets/sign-minus.png`,
};
export const CREDIT_IMAGES = {
  particle: `${BASE_PATH}/assets/credit-particle.png`,
  portrait: `${BASE_PATH}/assets/credit-portrait.webp`,
};
