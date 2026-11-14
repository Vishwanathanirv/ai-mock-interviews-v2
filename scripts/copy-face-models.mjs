// Copies the face models that video analysis needs into public/, so the site serves them itself
// (no third-party CDN at runtime). Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@vladmandic/human/models");
const to = join(root, "public/models/human");
mkdirSync(to, { recursive: true });
for (const m of ["blazeface", "facemesh", "iris", "emotion"]) for (const ext of ["json", "bin"]) copyFileSync(join(from, `${m}.${ext}`), join(to, `${m}.${ext}`));
