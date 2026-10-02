import fs from "node:fs/promises";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const [moduleUrl, stage, update] = process.argv.slice(2);
let held = false;
async function pause() {
  held = true;
  process.send({ ready: stage });
  await new Promise(resolve => process.once("message", resolve));
}

if (stage === "kernel") {
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const callback = args.pop();
    args.push(() => { void pause().then(() => callback()); });
    return listen.apply(this, args);
  };
} else if (stage === "partial-metadata") {
  const writeFile = fs.writeFile;
  fs.writeFile = async (path, content, options) => {
    if (!held && String(path).includes(".viewer-preferences-owner-")) {
      await writeFile(path, "{", options);
      await pause();
      return writeFile(path, content, { ...options, flag: "w" });
    }
    return writeFile(path, content, options);
  };
} else if (stage === "published") {
  const link = fs.link;
  fs.link = async (...args) => {
    await link(...args);
    if (!held && String(args[1]).endsWith("viewer-preferences.lock")) await pause();
  };
}
syncBuiltinESMExports();
const { savePreference } = await import(moduleUrl);
await savePreference(JSON.parse(update));
process.disconnect();
