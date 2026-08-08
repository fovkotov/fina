"use client";

import ReactDOM from "react-dom";
import { PRELOADED_IMAGES } from "@/lib/assets";

/** React поднимает эти preload в <head>, поэтому картинки едут сразу с документом. */
export function PreloadImages() {
  for (const src of PRELOADED_IMAGES) {
    ReactDOM.preload(src, { as: "image" });
  }
  return null;
}
