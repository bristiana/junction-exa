import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../shared/", import.meta.url);
const target = new URL("../extension/shared/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["tokens.css", "components.css"]) {
  await copyFile(new URL(file, source), new URL(file, target));
}
console.log("Shared styles copied to extension/shared/");
