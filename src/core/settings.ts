// Local UI settings (no account). Currently just the tutor mode, stored like the
// theme — in localStorage.
import type { TutorMode } from "./generation/tutor";

const TUTOR_MODE_KEY = "ascent-tutor-mode";

export function getTutorMode(): TutorMode {
  const v = localStorage.getItem(TUTOR_MODE_KEY);
  return v === "Socratic" || v === "Encyclopedic" ? v : "Mentor";
}

export function setTutorMode(mode: TutorMode) {
  localStorage.setItem(TUTOR_MODE_KEY, mode);
}
