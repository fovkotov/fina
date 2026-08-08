const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const AVATARS: Record<string, string> = {
  Аня: `${BASE_PATH}/assets/avatar-anya.png`,
  Андрей: `${BASE_PATH}/assets/avatar-andrey.png`,
};

export const SIGN_IMAGES = {
  deposit: `${BASE_PATH}/assets/sign-plus.png`,
  withdrawal: `${BASE_PATH}/assets/sign-minus.png`,
};

/** Знак и аватар рисуются по одному за раз, поэтому остальные догружаем заранее. */
export const PRELOADED_IMAGES = [
  ...Object.values(SIGN_IMAGES),
  ...Object.values(AVATARS),
];
